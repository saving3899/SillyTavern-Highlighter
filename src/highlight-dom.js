import { saveSettingsDebounced, chat } from '../../../../../script.js';
import { state } from './state.js';
import { getColors, getBackgroundColorFromHex } from './color.js';
import { getCurrentCharacterKey, getCurrentChatFile, getHighlightsForChatFile } from './character-keys.js';
import { batchUnwrapHighlights } from './utils.js';
import { injectBookmarkButtons } from './bookmark.js';

// 순환 참조 방지용 콜백
let _getCurrentSwipeId = null;
let _findHighlightById = null;
let _getDarkModeClass = null;
let _renderView = null;

export function initHighlightDomCallbacks(getCurrentSwipeIdFn, findHighlightByIdFn, getDarkModeClassFn, renderViewFn) {
    _getCurrentSwipeId = getCurrentSwipeIdFn;
    _findHighlightById = findHighlightByIdFn;
    _getDarkModeClass = getDarkModeClassFn;
    _renderView = renderViewFn;
}

// ====================================
// 형광펜 DOM 적용/제거/복원
// ====================================

/**
 * 채팅 내 모든 형광펜 복원
 */
export function restoreHighlightsInChat() {
    const chatFile = getCurrentChatFile();
    const charKey = getCurrentCharacterKey();

    if (!chatFile || !charKey) return;

    // ⭐ 현재 채팅 파일의 형광펜만 복원
    // avatar 키와 date_added 키 둘 다 확인 (마이그레이션 전 데이터 호환)
    let currentChatHighlights = getHighlightsForChatFile(charKey, chatFile);


    // ⭐ 화면에 하이라이트 표시
    const allHighlights = [...currentChatHighlights];

    // 성능 최적화: 메시지 요소를 미리 Map으로 캐시
    const mesElements = {};
    document.querySelectorAll('.mes[mesid]').forEach(el => {
        mesElements[el.getAttribute('mesid')] = el;
    });

    allHighlights.forEach(hl => {
        const mesEl = mesElements[hl.mesId];
        if (!mesEl) {
            return;
        }

        // 스와이프 ID 확인 - 현재 표시 중인 스와이프와 일치하는 경우만 하이라이트
        const currentSwipeId = _getCurrentSwipeId?.(hl.mesId) ?? 0;
        const hlSwipeId = hl.swipeId !== undefined ? hl.swipeId : 0; // 하위 호환성

        if (currentSwipeId !== hlSwipeId) {
            return; // 다른 스와이프는 스킵
        }

        const $mes = $(mesEl);
        const $text = $mes.find('.mes_text');

        const content = $text.html();
        if (!content) return;

        // ⭐ 성능 최적화: 이미 하이라이트가 적용된 경우 스킵
        if ($text.find(`.text-highlight[data-hl-id="${hl.id}"]`).length > 0) {
            return;
        }

        // ⭐ 형광펜 적용 시도
        // 단어 변환 호환: 현재 DOM에서 실패하면 원본 텍스트로도 시도
        try {
            const success = highlightTextInElement($text[0], hl);

            // DOM에서 실패한 경우, 원본 HTML로 재시도
            if (!success) {
                const originalHtml = $text.data('original-html');
                if (originalHtml) {
                    // 단어 변환이 적용된 상태 - 원본 HTML로 임시 교체 후 적용
                    const currentHtml = $text.html();
                    $text.html(originalHtml);

                    const retrySuccess = highlightTextInElement($text[0], hl);

                    if (retrySuccess) {
                        // 형광펜 적용 성공 - original-html도 업데이트
                        $text.data('original-html', $text.html());
                    }

                    // 단어 변환이 다시 적용되면 자동으로 처리됨
                }
            }

            // LLM 번역기 호환: 번역문↔원문 동시 하이라이트 (쌍 텍스트가 저장된 경우만)
            if (success && state.settings.translatorCompat && state.settings.translatorSyncHighlight &&
                hl.sourceType && hl.sourceType !== 'mixed' &&
                (hl.translatorOriginalText || hl.translatedText)) {
                applyTranslatorSyncHighlight($text[0], hl);
            }

            // LLM 번역기 호환: 번역문 매칭 실패 시에도 원문에는 형광펜 표시
            if (!success && state.settings.translatorCompat &&
                hl.sourceType === 'translated' && hl.translatorOriginalText) {
                applyOriginalTextFallbackHighlight($text[0], hl);
            }
        } catch (e) {
            // 실패해도 무시 (텍스트가 변경되었을 수 있음)
        }
    });

    // 이벤트는 위임으로 처리되므로 여기서는 바인딩 불필요

    // 책갈피 버튼 주입
    injectBookmarkButtons();
}

// 여러 문단에 걸친 텍스트를 하이라이트하는 헬퍼 함수
export function highlightTextInElement(element, hl) {
    // ⭐ 동적 색상 적용: Slot ID가 있으면 현재 프리셋의 해당 슬롯 색상 사용
    let displayColor = hl.color;
    if (hl.colorIndex !== undefined) {
        const currentColors = getColors();
        if (currentColors[hl.colorIndex]) {
            displayColor = currentColors[hl.colorIndex].bg;
        }
    }
    const bgColor = getBackgroundColorFromHex(displayColor);

    // 불필요한 요소 선택자 (결합 셀렉터로 매칭 최적화)
    let unwantedSelector = 'img,style,script,pre,code,svg,canvas,video,audio,iframe,object,embed,picture,source,.TH-render,.custom-imageWrapper,.custom-characterImage,[class*="-render"],[class*="code-block"]';

    // LLM 번역기 호환: sourceType에 따라 검색 범위 제한
    if (state.settings.translatorCompat && hl.sourceType) {
        if (hl.sourceType === 'translated') {
            unwantedSelector += ',.custom-original_text';
        } else if (hl.sourceType === 'original') {
            unwantedSelector += ',.custom-translated_text';
        }
    }

    // 불필요한 요소를 미리 Set에 수집 (TreeWalker 루프에서 반복 matches 호출 방지)
    const unwantedElements = new Set(element.querySelectorAll(unwantedSelector));

    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    const textNodes = [];
    let fullText = '';

    while (walker.nextNode()) {
        // 불필요한 요소의 자식 텍스트 노드는 제외
        let shouldSkip = false;
        let parent = walker.currentNode.parentElement;

        while (parent && parent !== element) {
            if (unwantedElements.has(parent)) {
                shouldSkip = true;
                break;
            }
            if (shouldSkip) break;
            parent = parent.parentElement;
        }

        if (!shouldSkip) {
            // 구조적 갭 감지: 이전 텍스트 노드와 현재 노드 사이에 이미지/블록 요소가 있으면 공백 삽입
            if (textNodes.length > 0) {
                const prev = textNodes[textNodes.length - 1];
                const curr = walker.currentNode;
                let hasGap = false;
                if (prev.parentNode === curr.parentNode) {
                    // 같은 부모: 형제 요소 중 img/블록 확인
                    let sib = prev.nextSibling;
                    while (sib && sib !== curr) {
                        if (sib.nodeType === 1) { hasGap = true; break; }
                        sib = sib.nextSibling;
                    }
                } else {
                    // 다른 부모: 블록 경계 확인
                    const blockRe = /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|DETAILS|FIGURE|SECTION|ARTICLE|TABLE|TR|TD|TH)$/;
                    const prevP = prev.parentElement;
                    const currP = curr.parentElement;
                    if ((prevP && blockRe.test(prevP.nodeName)) || (currP && blockRe.test(currP.nodeName))) {
                        hasGap = true;
                    }
                }
                if (hasGap && fullText.length > 0 && !/\s$/.test(fullText)) {
                    fullText += ' ';
                }
            }
            textNodes.push(walker.currentNode);
            fullText += walker.currentNode.textContent;
        }
    }

    // 줄바꿈 정규화 및 매핑 테이블 생성
    let searchText = hl.text;
    let normalizedSearchText = searchText.replace(/\s+/g, ' ').trim();
    let normalizedFullText = '';
    const indexMap = []; // normalizedFullText의 각 문자가 fullText의 어느 인덱스에 해당하는지

    let inWhitespace = false;
    for (let i = 0; i < fullText.length; i++) {
        const char = fullText[i];
        if (/\s/.test(char)) {
            if (!inWhitespace && normalizedFullText.length > 0) {
                normalizedFullText += ' ';
                indexMap.push(i);
                inWhitespace = true;
            }
        } else {
            normalizedFullText += char;
            indexMap.push(i);
            inWhitespace = false;
        }
    }
    normalizedFullText = normalizedFullText.trim();

    // 정규화된 텍스트에서 시작 위치 찾기
    let normalizedStartIndex = normalizedFullText.indexOf(normalizedSearchText);

    // ⭐ 폴백: originalText로 재시도 (하위 호환성)
    if (normalizedStartIndex === -1 && hl.originalText && hl.originalText !== hl.text) {
        const fallbackSearch = hl.originalText.replace(/\s+/g, ' ').trim();
        normalizedStartIndex = normalizedFullText.indexOf(fallbackSearch);
        if (normalizedStartIndex !== -1) {
            normalizedSearchText = fallbackSearch;
        }
    }

    if (normalizedStartIndex === -1) {
        return false;
    }

    const normalizedEndIndex = normalizedStartIndex + normalizedSearchText.length;

    // 매핑 테이블을 사용해 실제 인덱스 계산
    const startIndex = indexMap[normalizedStartIndex] || 0;
    const endIndex = indexMap[normalizedEndIndex - 1] + 1 || fullText.length;

    // 각 텍스트 노드의 fullText 내 시작 위치 계산 (갭 공백 포함)
    const nodeOffsets = [];
    let offsetPos = 0;
    for (let i = 0; i < textNodes.length; i++) {
        // 이전 노드 끝 ~ 현재 노드 시작 사이 갭 공백 보정
        if (i > 0) {
            const expectedPos = nodeOffsets[i - 1] + textNodes[i - 1].textContent.length;
            // fullText에서 현재 노드 텍스트가 시작하는 위치를 찾음
            const nodeText = textNodes[i].textContent;
            const searchFrom = expectedPos;
            const foundAt = fullText.indexOf(nodeText, searchFrom);
            offsetPos = (foundAt !== -1) ? foundAt : expectedPos;
        }
        nodeOffsets.push(offsetPos);
    }

    textNodes.forEach((node, idx) => {
        const nodeStart = nodeOffsets[idx];
        const nodeEnd = nodeStart + node.textContent.length;

        if (nodeEnd <= startIndex || nodeStart >= endIndex) {
            return; // 이 노드는 범위 밖
        }

        // 이 노드가 하이라이트 범위에 포함됨
        const overlapStart = Math.max(0, startIndex - nodeStart);
        const overlapEnd = Math.min(node.textContent.length, endIndex - nodeStart);

        if (overlapStart > 0 || overlapEnd < node.textContent.length) {
            // 노드를 분할해야 함
            const before = node.textContent.substring(0, overlapStart);
            const highlight = node.textContent.substring(overlapStart, overlapEnd);
            const after = node.textContent.substring(overlapEnd);

            const span = document.createElement('span');
            span.className = 'text-highlight';
            span.setAttribute('data-hl-id', hl.id);
            span.setAttribute('data-color', hl.color);
            span.style.backgroundColor = bgColor;
            if (hl.sourceType === 'original') span.style.opacity = '0.8';
            span.textContent = highlight;

            const parent = node.parentNode;
            const fragment = document.createDocumentFragment();

            if (before) fragment.appendChild(document.createTextNode(before));
            fragment.appendChild(span);
            if (after) fragment.appendChild(document.createTextNode(after));

            parent.replaceChild(fragment, node);
        } else {
            // 노드 전체를 하이라이트
            const span = document.createElement('span');
            span.className = 'text-highlight';
            span.setAttribute('data-hl-id', hl.id);
            span.setAttribute('data-color', hl.color);
            span.style.backgroundColor = bgColor;
            if (hl.sourceType === 'original') span.style.opacity = '0.8';
            span.textContent = node.textContent;

            node.parentNode.replaceChild(span, node);
        }
    });

    return true; // 성공
}

/**
 * LLM 번역기 호환: 원문/번역문 수정 모달
 */
export function showTranslatorEditModal(hlId) {
    const result = _findHighlightById?.(hlId);
    if (!result) return;

    const hl = result.highlight;
    if (!hl.sourceType || hl.sourceType === 'mixed') return;

    const pref = state.settings.translatorPanelDisplay || 'translated';

    // 참고용(비토글, 읽기전용) 텍스트와 수정 가능(토글) 텍스트 결정
    let referenceText, referenceLabel, editableField, editableLabel, editableValue;

    if (hl.sourceType === 'translated') {
        if (pref === 'original' && hl.translatorOriginalText) {
            // 패널 표시: 원문, 토글: 번역문
            referenceText = hl.translatorOriginalText;
            referenceLabel = '원문';
            editableField = 'text';
            editableLabel = '번역문';
            editableValue = hl.text;
        } else {
            // 패널 표시: 번역문, 토글: 원문
            referenceText = hl.text;
            referenceLabel = '번역문';
            editableField = 'translatorOriginalText';
            editableLabel = '원문';
            editableValue = hl.translatorOriginalText || '';
        }
    } else {
        if (pref === 'translated' && hl.translatedText) {
            // 패널 표시: 번역문, 토글: 원문
            referenceText = hl.translatedText;
            referenceLabel = '번역문';
            editableField = 'text';
            editableLabel = '원문';
            editableValue = hl.text;
        } else {
            // 패널 표시: 원문, 토글: 번역문
            referenceText = hl.text;
            referenceLabel = '원문';
            editableField = 'translatedText';
            editableLabel = '번역문';
            editableValue = hl.translatedText || '';
        }
    }

    const modalTitle = editableLabel + ' 수정';

    $('#highlight-translator-edit-modal').remove();

    const darkModeClass = _getDarkModeClass?.() || '';
    const modal = `
        <div id="highlight-translator-edit-modal" class="hl-modal-overlay">
            <div class="hl-modal ${darkModeClass}">
                <div class="hl-modal-header">
                    <h3>${modalTitle}</h3>
                    <button class="hl-modal-close">&times;</button>
                </div>
                <div class="hl-modal-body">
                    <div class="hl-translator-edit-section">
                        <label class="hl-translator-edit-label">${referenceLabel}</label>
                        <div class="hl-translator-edit-reference">${referenceText}</div>
                    </div>
                    <div class="hl-translator-edit-section">
                        <label class="hl-translator-edit-label">${editableLabel}</label>
                        <textarea class="hl-translator-edit-textarea" data-field="${editableField}">${editableValue}</textarea>
                    </div>
                </div>
                <div class="hl-modal-footer">
                    <button class="hl-modal-btn hl-modal-cancel">취소</button>
                    <button class="hl-modal-btn hl-modal-save">저장</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modal);

    const $modal = $('#highlight-translator-edit-modal');
    const $textarea = $modal.find('.hl-translator-edit-textarea');
    const origValue = $textarea.val();

    // textarea 높이를 내용에 맞게 자동 조절
    requestAnimationFrame(() => {
        $textarea.each(function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, window.innerHeight * 0.45) + 'px';
        });
    });

    // 저장
    $modal.find('.hl-modal-save').on('click', function () {
        const newVal = $modal.find('.hl-translator-edit-textarea').val().trim();
        let changed = false;
        if (hl[editableField] !== newVal) {
            hl[editableField] = newVal;
            changed = true;
        }

        if (changed) {
            state.settings.highlights[result.charId][result.chatFile].lastModified = Date.now();
            saveSettingsDebounced();
            refreshTranslatorSyncHighlight(hl);
            if ($('#highlighter-panel').hasClass('visible')) _renderView?.();
            toastr.success('수정되었습니다');
        }

        $modal.remove();
    });

    // 닫기/취소
    const closeModal = function () {
        const currentVal = $modal.find('.hl-translator-edit-textarea').val();
        if (currentVal !== origValue) {
            if (!confirm('취소하시겠습니까?\n저장되지 않은 변경사항이 사라집니다.')) return;
        }
        $modal.remove();
    };

    $modal.find('.hl-modal-close, .hl-modal-cancel').on('click', closeModal);
    $modal.on('click', function (e) {
        if (e.target === this) closeModal();
    });
}

/**
 * LLM 번역기 호환: DOM 동기화 하이라이트 갱신
 */
export function refreshTranslatorSyncHighlight(hl) {
    const $mes = $(`.mes[mesid="${hl.mesId}"]`);
    if (!$mes.length) return;

    const $text = $mes.find('.mes_text');
    // 기존 sync 하이라이트 제거 후 텍스트 노드 복원
    batchUnwrapHighlights(`.text-highlight.hl-sync-highlight[data-hl-id="${hl.id}"]`);
    // 재적용
    if (state.settings.translatorCompat && state.settings.translatorSyncHighlight &&
        hl.sourceType && hl.sourceType !== 'mixed') {
        applyTranslatorSyncHighlight($text[0], hl);
    }
}

/**
 * LLM 번역기 호환: 번역문 매칭 실패 시 원문에 직접 형광펜 적용
 * 재번역으로 번역문이 바뀌어도 원문은 변하지 않으므로 원문에는 표시
 */
export function applyOriginalTextFallbackHighlight(element, hl) {
    if (!hl.translatorOriginalText) return;

    // 동적 색상
    let displayColor = hl.color;
    if (hl.colorIndex !== undefined) {
        const currentColors = getColors();
        if (currentColors[hl.colorIndex]) displayColor = currentColors[hl.colorIndex].bg;
    }
    const bgColor = getBackgroundColorFromHex(displayColor);

    const syncText = hl.translatorOriginalText;
    const syncParagraphs = syncText.split('\n\n');

    // .custom-original_text 요소들에서 원문 찾기
    const originalSpans = element.querySelectorAll('.custom-original_text');

    // 다중 문단: 각 원문 span에 대응되는 문단 매칭
    if (originalSpans.length > 0 && syncParagraphs.length > 1) {
        const targets = [...originalSpans];
        for (let i = 0; i < targets.length && i < syncParagraphs.length; i++) {
            if (targets[i].querySelector(`.text-highlight[data-hl-id="${hl.id}"]`)) continue;
            _applyFallbackToSpan(targets[i], syncParagraphs[i], hl, bgColor);
        }
        return;
    }

    // 단일 문단 / 번역기 마크업 없는 경우
    const normalizedSync = syncText.replace(/\s+/g, ' ').trim();
    const searchTargets = originalSpans.length > 0 ? originalSpans : [element];
    for (const origSpan of searchTargets) {
        if (origSpan.querySelector(`.text-highlight[data-hl-id="${hl.id}"]`)) return;
        _applyFallbackToSpan(origSpan, syncText, hl, bgColor);
    }
}

function _applyFallbackToSpan(origSpan, syncText, hl, bgColor) {
    const normalizedSync = syncText.replace(/\s+/g, ' ').trim();

    const walker = document.createTreeWalker(origSpan, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    let fullText = '';
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
        fullText += walker.currentNode.textContent;
    }

    const normalizedFull = fullText.replace(/\s+/g, ' ').trim();
    if (!normalizedFull.includes(normalizedSync) && normalizedSync !== normalizedFull) return;

    // 정규화 인덱스 매핑
    let normalizedFullText = '';
    const indexMap = [];
    let inWhitespace = false;
    for (let i = 0; i < fullText.length; i++) {
        const char = fullText[i];
        if (/\s/.test(char)) {
            if (!inWhitespace && normalizedFullText.length > 0) {
                normalizedFullText += ' ';
                indexMap.push(i);
                inWhitespace = true;
            }
        } else {
            normalizedFullText += char;
            indexMap.push(i);
            inWhitespace = false;
        }
    }
    normalizedFullText = normalizedFullText.trim();

    const startNorm = normalizedFullText.indexOf(normalizedSync);
    if (startNorm === -1) {
        // 전체 매칭 폴백
        textNodes.forEach(node => {
            const span = document.createElement('span');
            span.className = 'text-highlight';
            span.setAttribute('data-hl-id', hl.id);
            span.setAttribute('data-color', hl.color);
            span.style.backgroundColor = bgColor;
            span.style.opacity = '0.8';
            span.textContent = node.textContent;
            node.parentNode.replaceChild(span, node);
        });
        return;
    }

    const endNorm = startNorm + normalizedSync.length;
    const startIndex = indexMap[startNorm] || 0;
    const endIndex = (indexMap[endNorm - 1] !== undefined ? indexMap[endNorm - 1] + 1 : fullText.length);

    let currentPos = 0;
    textNodes.forEach(node => {
        const nodeStart = currentPos;
        const nodeEnd = nodeStart + node.textContent.length;
        currentPos = nodeEnd;

        if (nodeEnd <= startIndex || nodeStart >= endIndex) return;

        const overlapStart = Math.max(0, startIndex - nodeStart);
        const overlapEnd = Math.min(node.textContent.length, endIndex - nodeStart);

        const before = node.textContent.substring(0, overlapStart);
        const highlight = node.textContent.substring(overlapStart, overlapEnd);
        const after = node.textContent.substring(overlapEnd);

        const span = document.createElement('span');
        span.className = 'text-highlight';
        span.setAttribute('data-hl-id', hl.id);
        span.setAttribute('data-color', hl.color);
        span.style.backgroundColor = bgColor;
        span.style.opacity = '0.8';
        span.textContent = highlight;

        const fragment = document.createDocumentFragment();
        if (before) fragment.appendChild(document.createTextNode(before));
        fragment.appendChild(span);
        if (after) fragment.appendChild(document.createTextNode(after));
        node.parentNode.replaceChild(fragment, node);
    });
}

/**
 * LLM 번역기 호환: 번역문↔원문 동시 하이라이트
 */
export function applyTranslatorSyncHighlight(element, hl) {
    // 동적 색상
    let displayColor = hl.color;
    if (hl.colorIndex !== undefined) {
        const currentColors = getColors();
        if (currentColors[hl.colorIndex]) displayColor = currentColors[hl.colorIndex].bg;
    }
    const bgColor = getBackgroundColorFromHex(displayColor);

    // 이미 적용된 하이라이트 span 찾기
    const existingSpans = element.querySelectorAll(`.text-highlight[data-hl-id="${hl.id}"]`);
    if (!existingSpans.length) return;

    // 동기화 텍스트 결정
    let syncText;
    if (hl.sourceType === 'translated') {
        syncText = hl.translatorOriginalText;
    } else if (hl.sourceType === 'original') {
        syncText = hl.translatedText;
    } else {
        return;
    }
    if (!syncText) return;

    const targetClass = hl.sourceType === 'translated' ? 'custom-original_text' : 'custom-translated_text';

    // 원문 쪽에만 opacity 적용 (번역문 쪽은 항상 1.0)
    const syncOpacity = (targetClass === 'custom-original_text') ? '0.8' : '1';

    // 하이라이트 span들이 속한 번역기 부모 요소들 수집 (DOM 순서)
    const parentSet = new Set();
    const parentEls = [];
    for (const span of existingSpans) {
        const p = span.closest('.custom-translated_text') || span.closest('.custom-original_text');
        if (p && !parentSet.has(p)) {
            parentSet.add(p);
            parentEls.push(p);
        }
    }

    // 각 부모의 쌍 요소 수집
    const pairSpans = [];
    for (const parentEl of parentEls) {
        const pair = _findPairElement(parentEl, targetClass);
        if (pair && !pair.querySelector(`.text-highlight[data-hl-id="${hl.id}"]`)) {
            pairSpans.push(pair);
        }
    }

    if (!pairSpans.length) return;

    // syncText를 문단으로 분리, 각 pairSpan에 대응
    const syncParagraphs = syncText.split('\n\n');

    for (let i = 0; i < pairSpans.length; i++) {
        const paragraphText = (pairSpans.length === syncParagraphs.length)
            ? syncParagraphs[i]
            : syncText; // 개수 불일치 시 전체 텍스트로 폴백
        _applySyncToPairSpan(pairSpans[i], paragraphText, hl, bgColor, syncOpacity);
    }
}

// 번역기 요소의 쌍 찾기 헬퍼
function _findPairElement(el, targetClass) {
    const detailsContainer = el.closest('.custom-llm-translator-details');
    if (detailsContainer) {
        return detailsContainer.querySelector('.' + targetClass);
    }
    const isForward = targetClass === 'custom-original_text';
    let sibling = isForward ? el.nextElementSibling : el.previousElementSibling;
    while (sibling) {
        if (sibling.classList.contains(targetClass)) return sibling;
        if (isForward && sibling.classList.contains('custom-translated_text')) break;
        if (!isForward && sibling.classList.contains('custom-original_text')) break;
        sibling = isForward ? sibling.nextElementSibling : sibling.previousElementSibling;
    }
    return null;
}

// 단일 pairSpan에 동기화 하이라이트 적용
function _applySyncToPairSpan(pairSpan, syncText, hl, bgColor, syncOpacity) {
    const walker = document.createTreeWalker(pairSpan, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    let fullText = '';
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
        fullText += walker.currentNode.textContent;
    }

    const normalizedSync = syncText.replace(/\s+/g, ' ').trim();
    const normalizedFull = fullText.replace(/\s+/g, ' ').trim();

    const wrapAllNodes = () => {
        textNodes.forEach(node => {
            const span = document.createElement('span');
            span.className = 'text-highlight hl-sync-highlight';
            span.setAttribute('data-hl-id', hl.id);
            span.setAttribute('data-color', hl.color);
            span.style.backgroundColor = bgColor;
            span.style.opacity = syncOpacity;
            span.textContent = node.textContent;
            node.parentNode.replaceChild(span, node);
        });
    };

    if (normalizedSync === normalizedFull) {
        wrapAllNodes();
        return;
    }

    // 부분 매칭 - 정규화 인덱스 매핑
    let normalizedFullText = '';
    const indexMap = [];
    let inWhitespace = false;
    for (let i = 0; i < fullText.length; i++) {
        const char = fullText[i];
        if (/\s/.test(char)) {
            if (!inWhitespace && normalizedFullText.length > 0) {
                normalizedFullText += ' ';
                indexMap.push(i);
                inWhitespace = true;
            }
        } else {
            normalizedFullText += char;
            indexMap.push(i);
            inWhitespace = false;
        }
    }
    normalizedFullText = normalizedFullText.trim();

    const startNorm = normalizedFullText.indexOf(normalizedSync);
    if (startNorm === -1) {
        wrapAllNodes();
        return;
    }

    const endNorm = startNorm + normalizedSync.length;
    const startIndex = indexMap[startNorm] || 0;
    const endIndex = (indexMap[endNorm - 1] !== undefined ? indexMap[endNorm - 1] + 1 : fullText.length);

    let currentPos = 0;
    textNodes.forEach(node => {
        const nodeStart = currentPos;
        const nodeEnd = nodeStart + node.textContent.length;
        currentPos = nodeEnd;

        if (nodeEnd <= startIndex || nodeStart >= endIndex) return;

        const overlapStart = Math.max(0, startIndex - nodeStart);
        const overlapEnd = Math.min(node.textContent.length, endIndex - nodeStart);

        if (overlapStart > 0 || overlapEnd < node.textContent.length) {
            const before = node.textContent.substring(0, overlapStart);
            const highlight = node.textContent.substring(overlapStart, overlapEnd);
            const after = node.textContent.substring(overlapEnd);

            const span = document.createElement('span');
            span.className = 'text-highlight hl-sync-highlight';
            span.setAttribute('data-hl-id', hl.id);
            span.setAttribute('data-color', hl.color);
            span.style.backgroundColor = bgColor;
            span.style.opacity = syncOpacity;
            span.textContent = highlight;

            const fragment = document.createDocumentFragment();
            if (before) fragment.appendChild(document.createTextNode(before));
            fragment.appendChild(span);
            if (after) fragment.appendChild(document.createTextNode(after));
            node.parentNode.replaceChild(fragment, node);
        } else {
            const span = document.createElement('span');
            span.className = 'text-highlight hl-sync-highlight';
            span.setAttribute('data-hl-id', hl.id);
            span.setAttribute('data-color', hl.color);
            span.style.backgroundColor = bgColor;
            span.style.opacity = syncOpacity;
            span.textContent = node.textContent;
            node.parentNode.replaceChild(span, node);
        }
    });
}
