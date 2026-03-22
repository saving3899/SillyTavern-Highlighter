import { state } from './state.js';
import { getColors } from './color.js';
import { createHighlight } from './highlight-crud.js';

// 순환 참조 방지용 콜백
let _getDarkModeClass = null;

export function initHighlightModeCallbacks(getDarkModeClassFn) {
    _getDarkModeClass = getDarkModeClassFn;
}

// ====================================
// 형광펜 모드 (텍스트 선택 → 색상 메뉴)
// ====================================

export function enableHighlightMode() {
    // 이벤트 위임 방식으로 변경 - 동적으로 로드되는 메시지에도 작동
    $(document).off('mouseup.hl touchend.hl', '.mes_text').on('mouseup.hl touchend.hl', '.mes_text', function (e) {
        const element = this;

        // 편집 중인 textarea/input 내부에서의 선택은 무시
        if ($(e.target).closest('textarea, input, [contenteditable="true"]').length) return;

        // 모바일 터치 이벤트의 경우 약간의 딜레이 추가
        const isTouchEvent = e.type === 'touchend';

        // ⭐ 터치 이벤트 중복 방지 - 같은 터치가 여러 번 발생하는 것 방지
        if (isTouchEvent) {
            const now = Date.now();
            if (now - state.lastTouchEnd < 300) {
                // 300ms 이내 중복 터치는 무시
                return;
            }
            state.lastTouchEnd = now;

            // 기존 타이머 제거
            if (state.touchSelectionTimer) {
                clearTimeout(state.touchSelectionTimer);
                state.touchSelectionTimer = null;
            }
        }

        const delay = isTouchEvent ? 150 : 0;

        const processSelection = () => {
            try {
                const sel = window.getSelection();

                // ⭐ 안전장치: range가 없는 경우 처리
                if (!sel || sel.rangeCount === 0) {
                    return;
                }

                let text = sel.toString();

                // 앞뒤 빈줄 제거
                const originalText = text;
                text = text.trim();

                // 선택된 텍스트가 없으면 종료 (단순 클릭)
                if (text.length === 0) {
                    // 하이라이트 요소 클릭 시 컨텍스트 메뉴는 별도 이벤트에서 처리
                    return;
                }

                // ⭐ 텍스트가 너무 짧으면(1자 이하) 무시 (오터치 방지)
                if (text.length < 2 && isTouchEvent) {
                    return;
                }

                // 선택된 텍스트가 있으면 색상 메뉴 표시 (하이라이트 영역 포함해도 OK)

                const range = sel.getRangeAt(0);

                // 터치 이벤트와 마우스 이벤트 모두 지원
                // ⭐ 안전장치: 좌표가 없는 경우 기본값 설정
                let pageX = e.pageX || (e.originalEvent?.changedTouches?.[0]?.pageX) || e.clientX;
                let pageY = e.pageY || (e.originalEvent?.changedTouches?.[0]?.pageY) || e.clientY;

                // 좌표가 여전히 없으면 range 중앙 사용
                if (!pageX || !pageY) {
                    const rangeRect = range.getBoundingClientRect();
                    pageX = rangeRect.left + rangeRect.width / 2 + window.scrollX;
                    pageY = rangeRect.bottom + window.scrollY;
                }

                // trim으로 인해 범위가 변경된 경우 range 조정
                if (originalText !== text) {
                    const startOffset = originalText.indexOf(text);
                    const newRange = document.createRange();

                    try {
                        const startNode = range.startContainer;
                        const endNode = range.endContainer;

                        newRange.setStart(startNode, range.startOffset + startOffset);
                        newRange.setEnd(endNode, range.startOffset + startOffset + text.length);

                        showColorMenu(pageX, pageY, text, newRange, element);
                    } catch (err) {
                        showColorMenu(pageX, pageY, text, range, element);
                    }
                } else {
                    showColorMenu(pageX, pageY, text, range, element);
                }
            } catch (error) {
                console.warn('[SillyTavern-Highlighter] Error processing selection:', error);
            }
        };

        if (isTouchEvent) {
            // ⭐ 모바일: 타이머로 안정화
            state.touchSelectionTimer = setTimeout(processSelection, delay);
        } else {
            // 데스크탑: 즉시 실행
            setTimeout(processSelection, delay);
        }
    });

    // ⭐ 드래그 중 툴팁 억제: mousedown/touchstart 시 플래그 설정
    $(document).off('mousedown.hl_pointer touchstart.hl_pointer').on('mousedown.hl_pointer touchstart.hl_pointer', '.mes_text', function () {
        state.isPointerDown = true;
    });
    $(document).off('mouseup.hl_pointer touchend.hl_pointer').on('mouseup.hl_pointer touchend.hl_pointer', function () {
        state.isPointerDown = false;
    });

    // ⭐ Android용 selectionchange 이벤트 추가
    // Android에서는 텍스트 선택 핸들 드래그 시 touchend가 발생하지 않을 수 있음
    $(document).off('selectionchange.hl').on('selectionchange.hl', function () {
        // 디바운싱: 선택이 완료된 후에만 처리
        if (state.selectionChangeTimer) {
            clearTimeout(state.selectionChangeTimer);
        }

        // ⭐ 마우스/터치가 눌린 상태면 드래그 중이므로 메뉴 표시를 건너뜀
        if (state.isPointerDown) return;

        // 편집 중인 textarea/input 내부에서의 선택은 무시
        if (document.activeElement && /^(textarea|input)$/i.test(document.activeElement.tagName)) return;

        state.selectionChangeTimer = setTimeout(() => {
            try {
                const sel = window.getSelection();
                if (!sel || sel.rangeCount === 0) return;

                const text = sel.toString().trim();
                if (text.length < 2) return; // 너무 짧으면 무시

                // 선택된 텍스트가 .mes_text 내부에 있는지 확인
                const range = sel.getRangeAt(0);
                const container = range.commonAncestorContainer;
                const mesTextElement = $(container).closest('.mes_text')[0];

                if (!mesTextElement) return;

                // 선택 영역의 중앙 좌표 계산
                const rangeRect = range.getBoundingClientRect();
                const pageX = rangeRect.left + rangeRect.width / 2 + window.scrollX;
                const pageY = rangeRect.bottom + window.scrollY;

                showColorMenu(pageX, pageY, text, range, mesTextElement);
            } catch (error) {
                console.warn('[SillyTavern-Highlighter] Error in selectionchange:', error);
            }
        }, 300); // 300ms 디바운싱
    });
}

export function disableHighlightMode() {
    $(document).off('mouseup.hl touchend.hl', '.mes_text');
    $(document).off('mousedown.hl_pointer touchstart.hl_pointer', '.mes_text');
    $(document).off('mouseup.hl_pointer touchend.hl_pointer');
    $(document).off('selectionchange.hl'); // ⭐ Android용 selectionchange 이벤트 제거
    state.isPointerDown = false;

    // ⭐ 대기 중인 터치 타이머 제거
    if (state.touchSelectionTimer) {
        clearTimeout(state.touchSelectionTimer);
        state.touchSelectionTimer = null;
    }

    // ⭐ selectionchange 타이머 제거
    if (state.selectionChangeTimer) {
        clearTimeout(state.selectionChangeTimer);
        state.selectionChangeTimer = null;
    }
}

export function showColorMenu(x, y, text, range, el) {
    // 기존 메뉴와 이벤트 제거
    removeColorMenu();

    const colors = getColors();
    const colorButtons = colors.map(c =>
        `<button class="hl-color-btn" data-color="${c.bg}" style="background: ${c.bg}"></button>`
    ).join('');

    // 선택된 텍스트의 위치 가져오기
    const rangeRect = range.getBoundingClientRect();

    // Y축: 텍스트 바로 아래 (page 좌표)
    const menuY = rangeRect.bottom + window.scrollY + 5;

    const menu = `
        <div id="highlight-color-menu" class="${_getDarkModeClass?.() || ''}" style="top: ${menuY}px; left: 0px;">
            ${colorButtons}
        </div>
    `;

    $('body').append(menu);

    const $menu = $('#highlight-color-menu');

    // 렌더 후 실제 크기를 측정하여 선택 영역 가운데 정렬 + 클램핑
    requestAnimationFrame(() => {
        if (!$menu.length) return;
        const menuW = $menu[0].offsetWidth;
        const menuH = $menu[0].offsetHeight;

        // X축: 선택 영역 중앙에 가운데 정렬
        const centerX = rangeRect.left + window.scrollX + (rangeRect.width / 2);
        let left = centerX - (menuW / 2);

        // 좌우 클램핑
        const margin = 4;
        if (left < margin + window.scrollX) left = margin + window.scrollX;
        if (left + menuW > window.scrollX + window.innerWidth - margin) {
            left = window.scrollX + window.innerWidth - margin - menuW;
        }

        $menu.css('left', left + 'px');

        // 하단 경계 확인 — 넘치면 텍스트 위쪽으로 이동
        const menuRect = $menu[0].getBoundingClientRect();
        if (menuRect.bottom > window.innerHeight - 4) {
            $menu.css('top', (rangeRect.top + window.scrollY - menuH - 5) + 'px');
        }

        // 상단 경계 확인
        const menuRectAfter = $menu[0].getBoundingClientRect();
        if (menuRectAfter.top < 4) {
            $menu.css('top', (rangeRect.bottom + window.scrollY + 5) + 'px');
        }
    });

    $('.hl-color-btn').off('click').on('click', function (e) {
        e.stopPropagation();
        createHighlight(text, $(this).data('color'), range, el);
        removeColorMenu();
    });

    // document click 이벤트 등록 (추적 가능하도록)
    state.colorMenuDocClickHandler = function (e) {
        if (!$(e.target).closest('#highlight-color-menu').length) {
            removeColorMenu();
        }
    };

    setTimeout(() => {
        $(document).on('click.colorMenu', state.colorMenuDocClickHandler);
    }, 100);
}

export function removeColorMenu() {
    $('#highlight-color-menu').remove();
    if (state.colorMenuDocClickHandler) {
        $(document).off('click.colorMenu', state.colorMenuDocClickHandler);
        state.colorMenuDocClickHandler = null;
    }
}
