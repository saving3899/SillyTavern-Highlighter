import { saveSettingsDebounced, chat } from '../../../../../script.js';
import { state } from './state.js';
import { VIEW_LEVELS } from './constants.js';
import { getCurrentCharacterKey, getCurrentChatFile, getCharacterNameByKey } from './character-keys.js';
import { getMessagePreview } from './utils.js';

// 순환 참조 방지용 콜백
let _updateTabCounts = null;
let _renderView = null;

export function initBookmarkCallbacks(updateTabCountsFn, renderViewFn) {
    _updateTabCounts = updateTabCountsFn;
    _renderView = renderViewFn;
}

// ====================================
// 책갈피 (Bookmark) 관련 함수
// ====================================

/**
 * 메시지의 발신자 레이블 (이름#id 형식)
 */
export function getMessageLabel(mesId) {
    // mesId는 DOM의 mesid 속성값과 동일함 (chat 배열의 인덱스)
    const message = chat[mesId];
    if (!message) return `메시지#${mesId}`;

    let name = '';
    if (message.is_system) {
        return '시스템';
    } else if (message.is_user) {
        name = message.name || '나';
    } else {
        const charKey = getCurrentCharacterKey();
        name = message.name || getCharacterNameByKey(charKey);
    }

    return `${name}#${mesId}`;
}

/**
 * 책갈피 개수 가져오기
 * @param {string} characterId - 캐릭터 키
 * @param {string|null} chatFile - 채팅 파일 (null이면 캐릭터 전체)
 * @returns {number}
 */
export function getBookmarkCount(characterId, chatFile) {
    if (!state.settings.bookmarks?.[characterId]) return 0;
    if (chatFile) {
        return state.settings.bookmarks[characterId]?.[chatFile]?.bookmarks?.length || 0;
    }
    let count = 0;
    const chats = state.settings.bookmarks[characterId];
    if (chats) {
        Object.values(chats).forEach(cd => { count += (cd.bookmarks?.length || 0); });
    }
    return count;
}

/**
 * 캐릭터 전체 책갈피 수 (캐릭터 목록에서 표시용)
 */
export function getTotalBookmarksForCharacter(charId) {
    return getBookmarkCount(charId, null);
}

/**
 * 현재 채팅에서 메시지가 책갈피되어 있는지 확인
 */
export function isMessageBookmarked(mesId) {
    const charKey = getCurrentCharacterKey();
    const chatFile = getCurrentChatFile();
    if (!charKey || !chatFile) return false;
    const bookmarks = state.settings.bookmarks?.[charKey]?.[chatFile]?.bookmarks;
    if (!bookmarks) return false;
    return bookmarks.some(b => b.mesId === mesId);
}

/**
 * 책갈피 토글 (추가/제거)
 */
export function toggleBookmark(mesId) {
    const charKey = getCurrentCharacterKey();
    const chatFile = getCurrentChatFile();
    if (!charKey || !chatFile) return;

    // 초기화
    if (!state.settings.bookmarks[charKey]) state.settings.bookmarks[charKey] = {};
    if (!state.settings.bookmarks[charKey][chatFile]) state.settings.bookmarks[charKey][chatFile] = { bookmarks: [], lastModified: Date.now() };

    const bookmarks = state.settings.bookmarks[charKey][chatFile].bookmarks;
    const existingIdx = bookmarks.findIndex(b => b.mesId === mesId);

    if (existingIdx !== -1) {
        // 제거
        bookmarks.splice(existingIdx, 1);
    } else {
        // 추가
        bookmarks.push({
            id: `bm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            mesId: mesId,
            preview: getMessagePreview(mesId),
            timestamp: Date.now(),
            label: getMessageLabel(mesId),
        });
    }

    state.settings.bookmarks[charKey][chatFile].lastModified = Date.now();
    saveSettingsDebounced();

    // UI 업데이트
    updateBookmarkButton(mesId);
    if (state.currentView === VIEW_LEVELS.HIGHLIGHT_LIST) {
        _updateTabCounts?.();
        const activeTab = $('.highlighter-tab.active').data('tab');
        if (activeTab === 'bookmarks' || activeTab === 'all') {
            _renderView?.();
        }
    }
}

/**
 * 책갈피 삭제 (패널에서)
 */
export function deleteBookmark(characterId, chatFile, bookmarkId) {
    const bookmarks = state.settings.bookmarks?.[characterId]?.[chatFile]?.bookmarks;
    if (!bookmarks) return;

    const idx = bookmarks.findIndex(b => b.id === bookmarkId);
    if (idx === -1) return;

    const mesId = bookmarks[idx].mesId;
    bookmarks.splice(idx, 1);
    state.settings.bookmarks[characterId][chatFile].lastModified = Date.now();
    saveSettingsDebounced();

    // 현재 채팅의 메시지면 버튼 상태 업데이트
    const currentChar = getCurrentCharacterKey();
    const currentChat = getCurrentChatFile();
    if (characterId === currentChar && chatFile === currentChat) {
        updateBookmarkButton(mesId);
    }
}

/**
 * 메시지의 책갈피 버튼 상태 업데이트
 */
export function updateBookmarkButton(mesId) {
    const $mes = $(`.mes[mesid="${mesId}"]`);
    if (!$mes.length) return;
    const $btn = $mes.find('.hl-bookmark-btn');
    if (!$btn.length) return;
    const isBookmarked = isMessageBookmarked(mesId);
    $btn.toggleClass('hl-bookmarked', isBookmarked);
    $btn.find('i').attr('class', isBookmarked ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark');
    $btn.attr('title', isBookmarked ? '책갈피 해제' : '책갈피');
}

/**
 * 모든 표시된 메시지의 책갈피 버튼 업데이트
 */
export function updateAllBookmarkButtons() {
    document.querySelectorAll('.mes[mesid]').forEach(el => {
        const mesId = parseInt(el.getAttribute('mesid'));
        if (!isNaN(mesId)) {
            updateBookmarkButton(mesId);
        }
    });
}

/**
 * 책갈피 뷰용 데이터 가져오기
 */
export function getBookmarksForView(characterId, chatFile) {
    if (!characterId) return [];

    if (chatFile) {
        return (state.settings.bookmarks?.[characterId]?.[chatFile]?.bookmarks || []).map(b => ({ ...b, _chatFile: chatFile }));
    }

    // 캐릭터 전체 모드
    let all = [];
    const chats = state.settings.bookmarks?.[characterId];
    if (chats) {
        Object.entries(chats).forEach(([cf, chatData]) => {
            if (chatData?.bookmarks) {
                chatData.bookmarks.forEach(b => {
                    all.push({ ...b, _chatFile: cf });
                });
            }
        });
    }
    return all;
}

/**
 * 채팅 메시지에 책갈피 버튼 주입
 */
export function injectBookmarkButtons() {
    const position = state.settings.bookmarkButtonPosition || 'extraMesButtons';
    if (position === 'none') return;

    // 이미 주입된 메시지는 제외하고 선택 (CSS 선택자로 필터링)
    const messages = document.querySelectorAll('.mes:not([data-hl-bm-injected])');
    for (const mesEl of messages) {
        const mesId = parseInt(mesEl.getAttribute('mesid'));
        if (isNaN(mesId)) continue;

        mesEl.setAttribute('data-hl-bm-injected', '1');

        const isBookmarked = isMessageBookmarked(mesId);
        const iconClass = isBookmarked ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark';
        const activeClass = isBookmarked ? ' hl-bookmarked' : '';
        const title = isBookmarked ? '책갈피 해제' : '책갈피';

        if (position === 'extraMesButtons') {
            const extraBtns = mesEl.querySelector('.extraMesButtons');
            if (extraBtns) {
                extraBtns.insertAdjacentHTML('beforeend',
                    `<div class="mes_button hl-bookmark-btn${activeClass}" title="${title}" data-mes-id="${mesId}"><i class="${iconClass}"></i></div>`);
            }
        } else {
            const posClass = position === 'topLeft' ? 'hl-bookmark-pos-left' : 'hl-bookmark-pos-right';
            mesEl.style.position = 'relative';
            mesEl.insertAdjacentHTML('beforeend',
                `<div class="hl-bookmark-btn hl-bookmark-overlay ${posClass}${activeClass}" title="${title}" data-mes-id="${mesId}"><i class="${iconClass}"></i></div>`);
        }
    }
}
