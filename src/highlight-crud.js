import { saveSettingsDebounced, chat } from '../../../../../script.js';
import { state } from './state.js';
import { getColorIndex, getBackgroundColorFromHex } from './color.js';
import { getCurrentCharacterKey, getCurrentChatFile, getCharacterNameByKey, findCharacterByKey, getTotalHighlightsForCharacter } from './character-keys.js';
import { batchUnwrapHighlights } from './utils.js';
import { getMessageLabel } from './bookmark.js';
import { applyTranslatorSyncHighlight } from './highlight-dom.js';

// 순환 참조 방지용 콜백
let _renderView = null;
let _getDarkModeClass = null;
let _navigateToCharacterList = null;
let _navigateToChatList = null;

export function initHighlightCrudCallbacks(renderViewFn, getDarkModeClassFn, navigateToCharacterListFn, navigateToChatListFn) {
    _renderView = renderViewFn;
    _getDarkModeClass = getDarkModeClassFn;
    _navigateToCharacterList = navigateToCharacterListFn;
    _navigateToChatList = navigateToChatListFn;
}

// ====================================
// 텍스트 오프셋 / 번역기 컨텍스트 감지
// ====================================

function calculateTextOffset(mesElement, range) {
    if (!range) return 0;
    const walker = document.createTreeWalker(
        mesElement,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    let offset = 0;
    let node;

    while (node = walker.nextNode()) {
        if (node === range.startContainer) {
            return offset + range.startOffset;
        }
        offset += node.textContent.length;
    }

    return 0;
}

// 번역기 요소의 쌍 찾기 헬퍼
function findTranslatorPair(el, pairClass) {
    // Case 1: <details> 래퍼
    const detailsContainer = el.closest('.custom-llm-translator-details');
    if (detailsContainer) {
        return detailsContainer.querySelector('.' + pairClass);
    }
    // Case 2: 형제 관계 (unfolded 모드)
    const isForward = pairClass === 'custom-original_text';
    let sibling = isForward ? el.nextElementSibling : el.previousElementSibling;
    while (sibling) {
        if (sibling.classList.contains(pairClass)) return sibling;
        // 다른 번역기 요소를 만나면 쌍이 아님 → 탐색 중단
        if (isForward && sibling.classList.contains('custom-translated_text')) break;
        if (!isForward && sibling.classList.contains('custom-original_text')) break;
        sibling = isForward ? sibling.nextElementSibling : sibling.previousElementSibling;
    }
    return null;
}

// LLM 번역기 DOM에서 번역문/원문 쌍 감지 (다중 문단 지원)
function detectTranslatorContext(range) {
    if (!state.settings.translatorCompat) return null;

    let startNode = range.startContainer;
    if (startNode.nodeType === 3) startNode = startNode.parentElement;
    let endNode = range.endContainer;
    if (endNode.nodeType === 3) endNode = endNode.parentElement;

    const startTranslated = startNode.closest('.custom-translated_text');
    const startOriginal = startNode.closest('.custom-original_text');
    const endTranslated = endNode.closest('.custom-translated_text');
    const endOriginal = endNode.closest('.custom-original_text');

    // 번역기 컨텍스트가 아니면 null
    if (!startTranslated && !startOriginal && !endTranslated && !endOriginal) return null;

    // sourceType: 시작 노드 기준 (시작이 번역기 밖이면 끝 기준)
    let sourceType;
    if (startTranslated) sourceType = 'translated';
    else if (startOriginal) sourceType = 'original';
    else if (endTranslated) sourceType = 'translated';
    else sourceType = 'original';

    // 선택 범위 내 모든 번역/원문 요소 수집
    const ancestor = range.commonAncestorContainer;
    let container = ancestor.nodeType === 3 ? ancestor.parentElement : ancestor;

    // container가 번역기 요소 내부이면 상위 .mes_text로 확장
    if (container.closest?.('.custom-translated_text') || container.closest?.('.custom-original_text')) {
        container = container.closest('.mes_text') || container.parentElement;
    }

    const translatedInRange = [...container.querySelectorAll('.custom-translated_text')]
        .filter(el => range.intersectsNode(el));
    const originalInRange = [...container.querySelectorAll('.custom-original_text')]
        .filter(el => range.intersectsNode(el));

    // 쌍 수집: range 내 요소들의 쌍 원문/번역문도 포함
    const translatedSet = new Set(translatedInRange);
    const originalSet = new Set(originalInRange);

    for (const el of translatedInRange) {
        const pair = findTranslatorPair(el, 'custom-original_text');
        if (pair) originalSet.add(pair);
    }
    for (const el of originalInRange) {
        const pair = findTranslatorPair(el, 'custom-translated_text');
        if (pair) translatedSet.add(pair);
    }

    // DOM 순서로 정렬하여 텍스트 수집
    const allInDOM = [...container.querySelectorAll('.custom-translated_text, .custom-original_text')];
    const orderedTranslated = allInDOM.filter(el => el.classList.contains('custom-translated_text') && translatedSet.has(el));
    const orderedOriginal = allInDOM.filter(el => el.classList.contains('custom-original_text') && originalSet.has(el));

    return {
        sourceType,
        translatedText: orderedTranslated.length > 0
            ? orderedTranslated.map(el => el.textContent.trim()).filter(Boolean).join('\n\n')
            : null,
        translatorOriginalText: orderedOriginal.length > 0
            ? orderedOriginal.map(el => el.textContent.trim()).filter(Boolean).join('\n\n')
            : null
    };
}

// ====================================
// 형광펜 CRUD
// ====================================

export function createHighlight(text, color, range, el) {
    const $mes = $(el).closest('.mes');
    const mesId = getMesId($mes);
    const chatFile = getCurrentChatFile();
    const charKey = getCurrentCharacterKey();

    if (!chatFile || !charKey) {
        toastr.error('채팅 정보를 가져올 수 없습니다');
        return;
    }

    const hlId = 'hl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    // 텍스트 시작 위치 계산
    const textOffset = calculateTextOffset(el, range);

    // LLM 번역기 호환: DOM 조작 전에 번역문/원문 쌍 감지 (range는 DOM 변경 후 무효)
    const translatorCtx = detectTranslatorContext(range);

    // range에서 줄바꿈을 보존하면서 텍스트 추출
    const clonedContents = range.cloneContents();

    // 임시 div에 넣어서 HTML 구조 확인
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(clonedContents);

    // LLM 번역기 호환: 대립 텍스트 영역 제거 (highlightTextInElement와 동일 필터링)
    if (state.settings.translatorCompat && translatorCtx?.sourceType) {
        if (translatorCtx.sourceType === 'translated') {
            tempDiv.querySelectorAll('.custom-original_text').forEach(el => el.remove());
        } else if (translatorCtx.sourceType === 'original') {
            tempDiv.querySelectorAll('.custom-translated_text').forEach(el => el.remove());
        }
    }

    // ⭐ 이미지 컨테이너/이미지를 줄바꿈 마커로 교체 (문단 구분 보존)
    ['.custom-imageWrapper', '.custom-characterImage'].forEach(selector => {
        tempDiv.querySelectorAll(selector).forEach(el => {
            el.replaceWith(document.createTextNode('\n'));
        });
    });
    tempDiv.querySelectorAll('img').forEach(el => {
        el.replaceWith(document.createTextNode('\n'));
    });

    // ⭐ 나머지 불필요한 요소 제거
    const unwantedSelectors = [
        'style', 'script', 'pre', 'code',
        'svg', 'canvas', 'video', 'audio', 'iframe',
        'object', 'embed', 'picture', 'source',
        '.TH-render',
        '[class*="-render"]',
        '[class*="code-block"]'
    ];
    unwantedSelectors.forEach(selector => {
        tempDiv.querySelectorAll(selector).forEach(el => el.remove());
    });

    // ⭐ 블록 요소 경계에 줄바꿈 마커 삽입 (문단 구분 보존)
    tempDiv.querySelectorAll('br').forEach(el => {
        el.replaceWith(document.createTextNode('\n'));
    });
    tempDiv.querySelectorAll('p, blockquote, h1, h2, h3, h4, h5, h6, li, tr, hr').forEach(el => {
        el.before(document.createTextNode('\n'));
        el.after(document.createTextNode('\n'));
    });

    // ⭐ TreeWalker로 텍스트 추출
    const textWalker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null, false);
    let actualText = '';
    while (textWalker.nextNode()) {
        actualText += textWalker.currentNode.textContent;
    }
    // 인라인 공백 정규화, 줄바꿈(문단 구분) 보존
    actualText = actualText.replace(/[^\S\n]+/g, ' ');
    actualText = actualText.replace(/ ?\n ?/g, '\n');
    actualText = actualText.replace(/\n{3,}/g, '\n\n');
    actualText = actualText.trim();

    // ⭐ 텍스트가 너무 짧거나 비어있으면 경고
    if (actualText.length === 0) {
        toastr.warning('텍스트만 선택해주세요 (이미지나 HTML 코드는 제외됩니다)');
        return;
    }

    // ⭐ 하위 호환성: 원본 메시지에서 매칭되는 텍스트 찾기
    // 정규식 변환된 텍스트도 저장 가능하도록 오류 없이 진행
    const originalMessage = chat[mesId]?.mes || '';
    const normalizedActualText = actualText.replace(/\s+/g, ' ').trim();

    // 마크다운 기호 제거하여 비교 (모든 일반 마크다운)
    const strippedOriginalMessage = originalMessage
        // 인라인 스타일
        .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')  // ***bold italic*** → bold italic
        .replace(/\*\*([^*]+)\*\*/g, '$1')      // **bold** → bold
        .replace(/\*([^*]+)\*/g, '$1')          // *italic* → italic
        .replace(/___([^_]+)___/g, '$1')        // ___bold italic___ → bold italic
        .replace(/__([^_]+)__/g, '$1')          // __bold__ → bold
        .replace(/_([^_]+)_/g, '$1')            // _italic_ → italic
        .replace(/~~([^~]+)~~/g, '$1')          // ~~strikethrough~~ → strikethrough
        .replace(/```[\s\S]*?```/g, '')         // ```code block``` → 제거
        .replace(/`([^`]+)`/g, '$1')            // `code` → code
        // 링크 및 이미지
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')     // ![alt](url) → 완전 제거
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // [text](url) → text
        // 헤더
        .replace(/^#{1,6}\s+/gm, '')            // # Header → Header
        // 인용문 및 리스트
        .replace(/^>\s+/gm, '')                 // > quote → quote
        .replace(/^[-*+]\s+/gm, '')             // - list → list
        .replace(/^\d+\.\s+/gm, '')             // 1. list → list
        // 수평선
        .replace(/^[-*_]{3,}$/gm, '')           // --- or *** → 제거
        // HTML 태그 제거 (img, br 등)
        .replace(/<[^>]+>/g, '')                // <img>, <br>, <div> 등 모든 HTML 태그 제거
        // 공백 정리
        .replace(/\s+/g, ' ').trim();
    const normalizedOriginalMessage = originalMessage.replace(/\s+/g, ' ').trim();

    // ⭐ 원본 텍스트 매칭 여부 확인 (하위 호환성용)
    // 매칭되면 originalText에 저장, 매칭되지 않아도 오류 없이 진행
    let matchedOriginalText = null;

    if (normalizedOriginalMessage.includes(normalizedActualText) ||
        strippedOriginalMessage.includes(normalizedActualText)) {
        // 원본 메시지에서 매칭됨
        matchedOriginalText = actualText;
    } else {
        // 원본에 없음 - original-html 확인
        const $mesText = $mes.find('.mes_text');
        const originalHtml = $mesText.data('original-html');

        if (originalHtml) {
            const checkDiv = document.createElement('div');
            checkDiv.innerHTML = originalHtml;
            checkDiv.querySelectorAll('.word-hider-hidden').forEach(el => {
                el.replaceWith(document.createTextNode(el.textContent || ''));
            });
            const originalText = (checkDiv.textContent || '').replace(/\s+/g, ' ').trim();

            if (originalText.includes(normalizedActualText)) {
                matchedOriginalText = actualText;
            }
        }
        // 매칭되지 않아도 오류 없이 진행 (정규식 변환 텍스트 지원)
    }

    try {
        // 단일 노드인 경우
        if (range.startContainer === range.endContainer && range.startContainer.nodeType === 3) {
            const span = document.createElement('span');
            span.className = 'text-highlight';
            span.setAttribute('data-hl-id', hlId);
            span.setAttribute('data-color', color);
            span.style.backgroundColor = getBackgroundColorFromHex(color);
            if (translatorCtx?.sourceType === 'original') span.style.opacity = '0.8';

            range.surroundContents(span);

            // 이벤트는 위임으로 처리되므로 여기서는 바인딩 불필요
        } else {
            // 여러 노드에 걸친 경우 - 각 텍스트 노드마다 span 생성
            const fragment = range.cloneContents();
            const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT, null, false);
            const textNodes = [];

            while (walker.nextNode()) {
                if (walker.currentNode.textContent.trim()) {
                    textNodes.push(walker.currentNode);
                }
            }

            // 원본 DOM에서 텍스트 노드 찾아서 span으로 감싸기
            const originalWalker = document.createTreeWalker(
                range.commonAncestorContainer,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );

            const nodesToWrap = [];
            while (originalWalker.nextNode()) {
                const node = originalWalker.currentNode;
                if (range.intersectsNode(node) && node.textContent.trim()) {
                    // LLM 번역기 호환: 대립 텍스트 영역의 노드는 제외 (동기화 하이라이트에서 별도 처리)
                    if (translatorCtx?.sourceType === 'translated' &&
                        node.parentElement?.closest('.custom-original_text')) continue;
                    if (translatorCtx?.sourceType === 'original' &&
                        node.parentElement?.closest('.custom-translated_text')) continue;
                    nodesToWrap.push(node);
                }
            }

            nodesToWrap.forEach((node) => {
                const span = document.createElement('span');
                span.className = 'text-highlight';
                span.setAttribute('data-hl-id', hlId);
                span.setAttribute('data-color', color);
                span.style.backgroundColor = getBackgroundColorFromHex(color);
                if (translatorCtx?.sourceType === 'original') span.style.opacity = '0.8';

                const nodeRange = document.createRange();
                nodeRange.selectNodeContents(node);

                // 시작/끝 노드인 경우 오프셋 조정
                if (node === range.startContainer) {
                    nodeRange.setStart(node, range.startOffset);
                }
                if (node === range.endContainer) {
                    nodeRange.setEnd(node, range.endOffset);
                }

                try {
                    nodeRange.surroundContents(span);
                    // 이벤트는 위임으로 처리되므로 여기서는 바인딩 불필요
                } catch (e) {
                    console.warn('[SillyTavern-Highlighter] Failed to wrap node:', e);
                }
            });
        }
    } catch (e) {
        console.error('[SillyTavern-Highlighter] Failed to create highlight:', e);
        toastr.error('형광펜 생성 실패');
        return;
    }

    // actualText 사용 (TreeWalker로 추출한 텍스트)

    // ⭐ 수정: 현재 메시지 라벨도 함께 저장
    saveHighlight(charKey, chatFile, {
        id: hlId,
        mesId: mesId,
        swipeId: getCurrentSwipeId(mesId), // 스와이프 ID 저장
        text: actualText,
        originalText: matchedOriginalText, // ⭐ 원본 텍스트 (하위 호환성 - 폴백 검색용)
        color: color,
        colorIndex: getColorIndex(color), // 색상 인덱스 저장 (프리셋 전환 시 정확한 매핑)
        note: '',
        label: getMessageLabel(mesId), // 라벨 저장
        timestamp: Date.now(),
        textOffset: textOffset, // 텍스트 시작 위치
        translatedText: translatorCtx?.translatedText || null,
        translatorOriginalText: translatorCtx?.translatorOriginalText || null,
        sourceType: translatorCtx?.sourceType || null
    });

    // LLM 번역기 호환: 실시간 동시 하이라이트 적용
    if (state.settings.translatorCompat && state.settings.translatorSyncHighlight &&
        translatorCtx?.sourceType && translatorCtx.sourceType !== 'mixed' &&
        (translatorCtx.translatorOriginalText || translatorCtx.translatedText)) {
        applyTranslatorSyncHighlight($mes.find('.mes_text')[0], {
            id: hlId,
            color: color,
            colorIndex: getColorIndex(color),
            sourceType: translatorCtx.sourceType,
            translatorOriginalText: translatorCtx.translatorOriginalText || null,
            translatedText: translatorCtx.translatedText || null
        });
    }

    // ⭐ 캐릭터 이름 캐싱 (Unknown 방지)
    const charName = getCharacterNameByKey(charKey);
    const liveChar = findCharacterByKey(charKey);
    if (liveChar && liveChar.name) {
        if (!state.settings.characterNames) state.settings.characterNames = {};
        state.settings.characterNames[charKey] = liveChar.name;
        saveSettingsDebounced();
    }

    toastr.success('형광펜 추가');

    if ($('#highlighter-panel').hasClass('visible')) {
        _renderView?.();
    }

    // 드래그 해제 - 약간의 딜레이를 줘서 다음 드래그 이벤트가 정상 작동하도록 함
    setTimeout(() => {
        window.getSelection().removeAllRanges();
    }, 50);
}

export function getMesId($mes) {
    const index = $mes.attr('mesid');
    if (index !== undefined) return parseInt(index);

    const mes = chat[$mes.index('.mes')];
    return mes?.mes_id || $mes.index('.mes');
}

export function getCurrentSwipeId(mesId) {
    const message = chat[mesId];
    if (!message) return 0;

    // swipe_id가 현재 표시 중인 스와이프의 인덱스
    return message.swipe_id || 0;
}

export function saveHighlight(charId, chatFile, hlData) {
    if (!state.settings.highlights[charId]) state.settings.highlights[charId] = {};
    if (!state.settings.highlights[charId][chatFile]) {
        state.settings.highlights[charId][chatFile] = {
            lastModified: Date.now(),
            highlights: []
        };
    }

    state.settings.highlights[charId][chatFile].highlights.push(hlData);
    state.settings.highlights[charId][chatFile].lastModified = Date.now();

    saveSettingsDebounced();
}

export function deleteHighlight(hlId, charId, chatFile) {
    const result = findHighlightById(hlId);
    if (!result) return;

    const hl = result.highlight;
    const hlCharId = charId || result.charId;
    const hlChatFile = chatFile || result.chatFile;

    // 모달 생성
    $('#highlight-delete-modal').remove();

    const isDark = state.settings.darkMode;
    const textColor = isDark ? '#e0e0e0' : '#222';
    const bgColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    const noteColor = isDark ? '#b0b0b0' : '#666';

    const modal = `
        <div id="highlight-delete-modal" class="hl-modal-overlay">
            <div class="hl-modal ${_getDarkModeClass?.() || ''}">
                <div class="hl-modal-header">
                    <h3>형광펜 삭제</h3>
                    <button class="hl-modal-close">&times;</button>
                </div>
                <div class="hl-modal-body">
                    <p style="margin: 0; padding: 10px; background: ${bgColor}; border-radius: 8px; line-height: 1.6; color: ${textColor} !important;">
                        <strong style="color: ${textColor} !important;">삭제할 형광펜:</strong><br>
                        ${hl.text.substring(0, 100)}${hl.text.length > 100 ? '...' : ''}
                    </p>
                    ${hl.note ? `<p style="margin-top: 10px; color: ${noteColor} !important;"><strong style="color: ${textColor} !important;">메모:</strong> ${hl.note}</p>` : ''}
                    <p style="margin-top: 20px; margin-bottom: 0; color: #e74c3c !important; font-weight: 500;">정말로 삭제하시겠습니까?</p>
                </div>
                <div class="hl-modal-footer">
                    <button class="hl-modal-btn hl-modal-cancel">취소</button>
                    <button class="hl-modal-btn hl-modal-delete" style="background: #e74c3c; color: white;">삭제</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modal);

    $('.hl-modal-delete').on('click', function () {
        const chatData = state.settings.highlights[hlCharId]?.[hlChatFile];
        if (!chatData) return;

        chatData.highlights = chatData.highlights.filter(h => h.id !== hlId);
        chatData.lastModified = Date.now();

        batchUnwrapHighlights(`.text-highlight[data-hl-id="${hlId}"]`);

        saveSettingsDebounced();

        if ($('#highlighter-panel').hasClass('visible')) _renderView?.();

        $('#highlight-delete-modal').remove();
        toastr.success('삭제됨');
    });

    $('.hl-modal-close, .hl-modal-cancel').on('click', function () {
        $('#highlight-delete-modal').remove();
    });

    $('.hl-modal-overlay').on('click', function (e) {
        if (e.target === this) $(this).remove();
    });
}

export function deleteCharacterHighlights() {
    const charName = getCharacterNameByKey(state.selectedCharacter);
    const totalCount = getTotalHighlightsForCharacter(state.selectedCharacter);

    // 모달 생성
    $('#highlight-delete-all-modal').remove();

    const isDark = state.settings.darkMode;
    const textColor = isDark ? '#e0e0e0' : '#222';
    const secondaryColor = isDark ? '#b0b0b0' : '#666';
    const warningBg = isDark ? 'rgba(231, 76, 60, 0.2)' : 'rgba(231, 76, 60, 0.1)';
    const warningBorder = isDark ? 'rgba(231, 76, 60, 0.4)' : 'rgba(231, 76, 60, 0.3)';

    const modal = `
        <div id="highlight-delete-all-modal" class="hl-modal-overlay">
            <div class="hl-modal ${_getDarkModeClass?.() || ''}">
                <div class="hl-modal-header">
                    <h3>캐릭터 형광펜 전체 삭제</h3>
                    <button class="hl-modal-close">&times;</button>
                </div>
                <div class="hl-modal-body">
                    <p style="margin: 0; padding: 15px; background: ${warningBg}; border-radius: 8px; line-height: 1.6; border: 1px solid ${warningBorder}; color: ${textColor} !important;">
                        <i class="fa-solid fa-exclamation-triangle" style="color: #e74c3c; margin-right: 8px;"></i>
                        <strong style="color: #e74c3c !important;">${charName}</strong> 캐릭터의 모든 형광펜 <strong style="color: #e74c3c !important;">${totalCount}개</strong>가 삭제됩니다.
                    </p>
                    <p style="margin-top: 15px; color: ${secondaryColor} !important; text-align: center;">
                        이 작업은 되돌릴 수 없습니다.<br>정말로 삭제하시겠습니까?
                    </p>
                </div>
                <div class="hl-modal-footer">
                    <button class="hl-modal-btn hl-modal-cancel">취소</button>
                    <button class="hl-modal-btn hl-modal-delete" style="background: #e74c3c; color: white;">전체 삭제</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modal);

    $('.hl-modal-delete').on('click', function () {
        // DOM에서 하이라이트 제거
        batchUnwrapHighlights();

        delete state.settings.highlights[state.selectedCharacter];
        saveSettingsDebounced();

        _navigateToCharacterList?.();
        $('#highlight-delete-all-modal').remove();
        toastr.success('캐릭터 형광펜 전체 삭제됨');
    });

    $('.hl-modal-close, .hl-modal-cancel').on('click', function () {
        $('#highlight-delete-all-modal').remove();
    });

    $('.hl-modal-overlay').on('click', function (e) {
        if (e.target === this) $(this).remove();
    });
}

export function deleteChatHighlights() {
    const chatData = state.settings.highlights[state.selectedCharacter]?.[state.selectedChat];
    if (!chatData) return;

    const highlightCount = chatData.highlights.length;

    // 모달 생성
    $('#highlight-delete-chat-modal').remove();

    const isDark = state.settings.darkMode;
    const textColor = isDark ? '#e0e0e0' : '#222';
    const secondaryColor = isDark ? '#b0b0b0' : '#666';
    const warningBg = isDark ? 'rgba(231, 76, 60, 0.2)' : 'rgba(231, 76, 60, 0.1)';
    const warningBorder = isDark ? 'rgba(231, 76, 60, 0.4)' : 'rgba(231, 76, 60, 0.3)';

    const modal = `
        <div id="highlight-delete-chat-modal" class="hl-modal-overlay">
            <div class="hl-modal ${_getDarkModeClass?.() || ''}">
                <div class="hl-modal-header">
                    <h3>채팅 형광펜 전체 삭제</h3>
                    <button class="hl-modal-close">&times;</button>
                </div>
                <div class="hl-modal-body">
                    <p style="margin: 0; padding: 15px; background: ${warningBg}; border-radius: 8px; line-height: 1.6; border: 1px solid ${warningBorder}; color: ${textColor} !important;">
                        <i class="fa-solid fa-exclamation-triangle" style="color: #e74c3c; margin-right: 8px;"></i>
                        <strong style="color: #e74c3c !important;">${state.selectedChat}</strong> 채팅의 모든 형광펜 <strong style="color: #e74c3c !important;">${highlightCount}개</strong>가 삭제됩니다.
                    </p>
                    <p style="margin-top: 15px; color: ${secondaryColor} !important; text-align: center;">
                        이 작업은 되돌릴 수 없습니다.<br>정말로 삭제하시겠습니까?
                    </p>
                </div>
                <div class="hl-modal-footer">
                    <button class="hl-modal-btn hl-modal-cancel">취소</button>
                    <button class="hl-modal-btn hl-modal-delete" style="background: #e74c3c; color: white;">전체 삭제</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modal);

    $('.hl-modal-delete').on('click', function () {
        // DOM에서 하이라이트 제거
        batchUnwrapHighlights();

        delete state.settings.highlights[state.selectedCharacter][state.selectedChat];
        saveSettingsDebounced();

        _navigateToChatList?.(state.selectedCharacter);
        $('#highlight-delete-chat-modal').remove();
        toastr.success('채팅 형광펜 전체 삭제됨');
    });

    $('.hl-modal-close, .hl-modal-cancel').on('click', function () {
        $('#highlight-delete-chat-modal').remove();
    });

    $('.hl-modal-overlay').on('click', function (e) {
        if (e.target === this) $(this).remove();
    });
}

export function findHighlightById(hlId) {
    // 먼저 현재 선택된 캐릭터/채팅에서 찾기
    if (state.selectedCharacter && state.selectedChat) {
        const chatData = state.settings.highlights[state.selectedCharacter]?.[state.selectedChat];
        if (chatData) {
            const found = chatData.highlights.find(h => h.id === hlId);
            if (found) return { highlight: found, charId: state.selectedCharacter, chatFile: state.selectedChat };
        }
    }

    // 현재 열린 채팅에서 찾기
    const currentCharKey = getCurrentCharacterKey();
    const currentChatFile = getCurrentChatFile();

    if (currentCharKey && currentChatFile) {
        const chatData = state.settings.highlights[currentCharKey]?.[currentChatFile];
        if (chatData) {
            const found = chatData.highlights.find(h => h.id === hlId);
            if (found) return { highlight: found, charId: currentCharKey, chatFile: currentChatFile };
        }
    }

    // 그래도 없으면 모든 캐릭터와 채팅을 검색
    for (const charId in state.settings.highlights) {
        for (const chatFile in state.settings.highlights[charId]) {
            const chatData = state.settings.highlights[charId][chatFile];
            if (chatData && chatData.highlights) {
                const found = chatData.highlights.find(h => h.id === hlId);
                if (found) {
                    return { highlight: found, charId: charId, chatFile: chatFile };
                }
            }
        }
    }

    return null;
}

export function changeHighlightColor(hlId, color, charId, chatFile) {
    const result = findHighlightById(hlId);
    if (!result) return;

    const hl = result.highlight;
    hl.color = color;
    hl.colorIndex = getColorIndex(color); // 색상 인덱스 업데이트
    $(`.text-highlight[data-hl-id="${hlId}"]`).attr('data-color', color).css('background-color', getBackgroundColorFromHex(color));

    saveSettingsDebounced();

    if ($('#highlighter-panel').hasClass('visible')) _renderView?.();

    toastr.success('색상 변경됨');
}
