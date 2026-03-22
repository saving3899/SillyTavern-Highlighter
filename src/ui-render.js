import { saveSettingsDebounced } from '../../../../../script.js';
import { state } from './state.js';
import { VIEW_LEVELS } from './constants.js';
import { escapeHtml, highlightSearchMatch, getMessagePreview, cleanStoredPreview } from './utils.js';
import {
    getCurrentCharacterKey,
    getCurrentChatFile,
    getCharacterNameByKey,
    getTotalHighlightsForCharacter,
    isGroupKey,
    getGroupIdFromKey,
    findGroupById,
    buildGroupAvatarHtml,
    findCharacterByKey,
    isDefaultAvatarImage,
} from './character-keys.js';
import { getColors } from './color.js';
import { getBookmarkCount, getTotalBookmarksForCharacter, getBookmarksForView, getMessageLabel } from './bookmark.js';

// 순환 참조 방지용 콜백
let _showBreadcrumbMoreMenu = null;
let _exitSelectMode = null;

export function initUiRenderCallbacks(showBreadcrumbMoreMenuFn, exitSelectModeFn) {
    _showBreadcrumbMoreMenu = showBreadcrumbMoreMenuFn;
    _exitSelectMode = exitSelectModeFn;
}

// ====================================
// 네비게이션
// ====================================

export function navigateToCurrentChat() {
    const chatFile = getCurrentChatFile();
    const charKey = getCurrentCharacterKey();

    if (!chatFile || !charKey) {
        toastr.warning('채팅이 열려있지 않습니다');
        return;
    }

    navigateToHighlightList(charKey, chatFile);
}

export function clearSearch() {
    state.searchQuery = '';
    state.searchCategory = 'all';
    $('#hl-search-input').val('');
    $('#hl-search-category-btn').text('전체');
    $('#hl-search-category-menu').remove();
    $('#hl-search-bar').hide();
}

export function toggleSearchBar() {
    const $bar = $('#hl-search-bar');
    if ($bar.is(':visible')) {
        clearSearch();
        renderView();
    } else {
        $bar.css('display', 'flex');
        $('#hl-search-input').focus();
    }
}

// ====================================
// 스크롤 위치 저장/복원
// ====================================

function getScrollKey() {
    if (state.currentView === VIEW_LEVELS.CHARACTER_LIST) return 'CHARACTER_LIST';
    if (state.currentView === VIEW_LEVELS.CHAT_LIST) return `CHAT_LIST:${state.selectedCharacter}`;
    return `HIGHLIGHT_LIST:${state.selectedCharacter}:${state.selectedChat}`;
}

export function saveScrollPosition() {
    const $content = $('.highlighter-content');
    if ($content.length) {
        state.viewScrollPositions[getScrollKey()] = $content.scrollTop();
    }
}

export function restoreScrollPosition() {
    const key = getScrollKey();
    const saved = state.viewScrollPositions[key];
    if (saved !== undefined) {
        const $content = $('.highlighter-content');
        requestAnimationFrame(() => $content.scrollTop(saved));
    }
}

// ====================================
// 뷰 네비게이션
// ====================================

export function navigateToCharacterList() {
    saveScrollPosition();
    state.currentView = VIEW_LEVELS.CHARACTER_LIST;
    state.selectedCharacter = null;
    state.selectedChat = null;
    renderView();
    restoreScrollPosition();
}

export function navigateToChatList(characterId) {
    saveScrollPosition();
    state.currentView = VIEW_LEVELS.CHAT_LIST;
    state.selectedCharacter = characterId;
    state.selectedChat = null;
    renderView();
    restoreScrollPosition();
}

export function navigateToHighlightList(characterId, chatFile) {
    saveScrollPosition();
    state.currentView = VIEW_LEVELS.HIGHLIGHT_LIST;
    state.selectedCharacter = characterId;
    state.selectedChat = chatFile;
    renderView();
}

// ====================================
// 브레드크럼
// ====================================

export function updateBreadcrumb() {
    const $breadcrumb = $('#highlighter-breadcrumb');
    $breadcrumb.empty();

    let html = '';

    // 정렬 옵션 초기화
    if (!state.settings.sortOptions) {
        state.settings.sortOptions = {
            characters: 'modified',
            chats: 'modified',
            highlights: 'created'
        };
    }

    // 뒤로가기 버튼 방식으로 변경 (state.currentView 기반)
    if (state.currentView === VIEW_LEVELS.HIGHLIGHT_LIST && state.selectedCharacter && state.selectedChat) {
        // 특정 채팅의 하이라이트 목록 → 채팅 목록
        html = '<button class="hl-back-btn" data-action="back-to-chat" title="채팅 목록"><i class="fa-solid fa-arrow-left"></i></button>';
        html += ` <span class="breadcrumb-current">${state.selectedChat}</span>`;
    } else if (state.currentView === VIEW_LEVELS.HIGHLIGHT_LIST && state.selectedCharacter && !state.selectedChat) {
        // 캐릭터 전체 형광펜 보기 → 채팅 목록
        html = '<button class="hl-back-btn" data-action="back-to-chat" title="채팅 목록"><i class="fa-solid fa-arrow-left"></i></button>';
        html += ' <span class="breadcrumb-current">모든 형광펜</span>';
    } else if (state.selectedCharacter) {
        // 채팅 목록 → 캐릭터 목록
        html = '<button class="hl-back-btn" data-action="back-to-home" title="모든 캐릭터"><i class="fa-solid fa-arrow-left"></i></button>';
        const charName = getCharacterNameByKey(state.selectedCharacter);
        html += ` <span class="breadcrumb-current">${charName}</span>`;

        // 이름 캐시 업데이트 (표시될 때마다 최신화)
        if (state.selectedCharacter && charName !== 'Unknown') {
            if (!state.settings.characterNames) state.settings.characterNames = {};
            if (state.settings.characterNames[state.selectedCharacter] !== charName) {
                state.settings.characterNames[state.selectedCharacter] = charName;
                saveSettingsDebounced();
            }
        }
    } else {
        // 캐릭터 목록 (최상위)
        html = '<span class="breadcrumb-current">모든 캐릭터</span>';
    }

    // 검색 버튼
    html += '<button class="hl-breadcrumb-nav-btn" id="hl-search-toggle-btn" title="검색"><i class="fa-solid fa-search"></i></button>';

    // 현재 채팅으로 이동 버튼
    html += '<button class="hl-breadcrumb-nav-btn" id="hl-current-chat-btn" title="현재 채팅으로 이동"><i class="fa-solid fa-location-dot"></i></button>';

    // 더보기 메뉴 (정렬 + 액션 통합) - 모든 뷰에 표시
    html += '<button class="hl-breadcrumb-nav-btn hl-more-btn" id="hl-breadcrumb-more-btn" title="더보기"><i class="fa-solid fa-ellipsis-vertical"></i></button>';

    $breadcrumb.html(html);

    // 기존 이벤트 제거 후 재바인딩 (중복 방지)
    $('[data-action="back-to-home"]').off('click').on('click', navigateToCharacterList);
    $('[data-action="back-to-chat"]').off('click').on('click', () => navigateToChatList(state.selectedCharacter));
    $('#hl-current-chat-btn').off('click').on('click', navigateToCurrentChat);
    $('#hl-search-toggle-btn').off('click').on('click', toggleSearchBar);
    $('#hl-breadcrumb-more-btn').off('click').on('click', (e) => _showBreadcrumbMoreMenu(e));
}

// ====================================
// 메인 렌더링
// ====================================

export function renderView() {
    // 선택 모드 해제
    if (state.selectMode) _exitSelectMode();

    updateBreadcrumb();
    state.panelContentDirty = false; // 렌더링 완료 → 최신 상태

    const $content = $('#highlighter-content');
    $content.empty();

    const activeTab = getActiveTab();

    switch (state.currentView) {
        case VIEW_LEVELS.CHARACTER_LIST:
            renderCharacterList($content, activeTab);
            break;
        case VIEW_LEVELS.CHAT_LIST:
            renderChatList($content, state.selectedCharacter, activeTab);
            break;
        case VIEW_LEVELS.HIGHLIGHT_LIST:
            renderHighlightList($content, state.selectedCharacter, state.selectedChat, activeTab);
            break;
    }
    updateTabCounts(activeTab);
}

/**
 * 현재 활성 탭 반환
 */
export function getActiveTab() {
    return $('.highlighter-tab.active').data('tab') || 'all';
}

// ====================================
// 탭 카운트
// ====================================

export function updateTabCounts(activeTab) {
    // 탭별 개수 표시 설정 확인
    if (!state.settings.showTabCounts) {
        $('[data-tab="all"]').html('전체');
        $('[data-tab="highlights"]').html('형광펜');
        $('[data-tab="notes"]').html('메모');
        $('[data-tab="bookmarks"]').html('책갈피');
        return;
    }

    let hlCount = 0, noteCount = 0, bmCount = 0;

    if (state.currentView === VIEW_LEVELS.CHARACTER_LIST) {
        // 전체 캐릭터 합산
        for (const charId of Object.keys(state.settings.highlights)) {
            hlCount += getTotalHighlightsForCharacter(charId);
            noteCount += getTotalNotesForCharacter(charId);
        }
        for (const charId of Object.keys(state.settings.bookmarks || {})) {
            bmCount += getTotalBookmarksForCharacter(charId);
        }
    } else if (state.currentView === VIEW_LEVELS.CHAT_LIST && state.selectedCharacter) {
        hlCount = getTotalHighlightsForCharacter(state.selectedCharacter);
        noteCount = getTotalNotesForCharacter(state.selectedCharacter);
        bmCount = getTotalBookmarksForCharacter(state.selectedCharacter);
    } else if (state.currentView === VIEW_LEVELS.HIGHLIGHT_LIST && state.selectedCharacter) {
        if (state.selectedChat) {
            const chatHL = state.settings.highlights[state.selectedCharacter]?.[state.selectedChat]?.highlights || [];
            hlCount = chatHL.length;
            noteCount = chatHL.filter(h => h.note && h.note.trim()).length;
            bmCount = getBookmarkCount(state.selectedCharacter, state.selectedChat);
        } else {
            hlCount = getTotalHighlightsForCharacter(state.selectedCharacter);
            noteCount = getTotalNotesForCharacter(state.selectedCharacter);
            bmCount = getTotalBookmarksForCharacter(state.selectedCharacter);
        }
    }

    const total = hlCount + bmCount;
    $('[data-tab="all"]').html(`전체 (${total})`);
    $('[data-tab="highlights"]').html(`형광펜 (${hlCount})`);
    $('[data-tab="notes"]').html(`메모 (${noteCount})`);
    $('[data-tab="bookmarks"]').html(`책갈피 (${bmCount})`);
}

// ====================================
// 유틸리티
// ====================================

/**
 * 캐릭터 전체 메모(노트) 수
 */
export function getTotalNotesForCharacter(charId) {
    const chats = state.settings.highlights[charId];
    if (!chats) return 0;
    let count = 0;
    Object.values(chats).forEach(chatData => {
        if (chatData?.highlights) {
            count += chatData.highlights.filter(h => h.note && h.note.trim()).length;
        }
    });
    return count;
}

// ====================================
// 캐릭터 목록 렌더링
// ====================================

export function renderCharacterList($container, activeTab) {
    // 기존 내용 초기화
    $container.empty();

    // 탭 필터에 맞는 캐릭터 수집
    const charIdSet = new Set();
    if (activeTab === 'bookmarks') {
        // 책갈피 탭: 책갈피가 있는 캐릭터만
        Object.keys(state.settings.bookmarks || {}).forEach(charId => {
            if (getTotalBookmarksForCharacter(charId) > 0) charIdSet.add(charId);
        });
    } else if (activeTab === 'notes') {
        // 메모 탭: 메모가 있는 형광펜이 있는 캐릭터만
        Object.keys(state.settings.highlights).forEach(charId => {
            if (getTotalNotesForCharacter(charId) > 0) charIdSet.add(charId);
        });
    } else if (activeTab === 'highlights') {
        // 형광펜 탭: 형광펜이 있는 캐릭터만
        Object.keys(state.settings.highlights).forEach(charId => {
            const chats = state.settings.highlights[charId];
            if (Object.keys(chats).some(cf => chats[cf].highlights?.length > 0)) charIdSet.add(charId);
        });
    } else {
        // 전체 탭: 형광펜 또는 책갈피가 있는 캐릭터
        Object.keys(state.settings.highlights).forEach(charId => {
            const chats = state.settings.highlights[charId];
            if (Object.keys(chats).some(cf => chats[cf].highlights?.length > 0)) charIdSet.add(charId);
        });
        Object.keys(state.settings.bookmarks || {}).forEach(charId => {
            if (getTotalBookmarksForCharacter(charId) > 0) charIdSet.add(charId);
        });
    }
    let charIds = [...charIdSet];

    // 검색 필터
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        const cat = state.searchCategory;
        charIds = charIds.filter(charId => {
            const charName = getCharacterNameByKey(charId).toLowerCase();
            const memo = (state.settings.characterMemos?.[charId] || '').toLowerCase();
            const chats = state.settings.highlights[charId];
            const hasHighlight = Object.values(chats).some(chatData =>
                chatData.highlights.some(h => h.text.toLowerCase().includes(q))
            );
            const hasNote = Object.values(chats).some(chatData =>
                chatData.highlights.some(h => (h.note || '').toLowerCase().includes(q))
            );
            const hasChatName = Object.keys(chats).some(chatFile => chatFile.toLowerCase().includes(q));

            if (cat === 'character') return charName.includes(q) || memo.includes(q);
            if (cat === 'chat') return hasChatName;
            if (cat === 'highlight') return hasHighlight;
            if (cat === 'note') return hasNote;
            // all
            return charName.includes(q) || memo.includes(q) || hasHighlight || hasNote || hasChatName;
        });
    }

    if (charIds.length === 0) {
        const tabEmptyMsg = { bookmarks: '저장된 책갈피가 없습니다', notes: '메모가 있는 형광펜이 없습니다', highlights: '저장된 형광펜이 없습니다' };
        const emptyMsg = state.searchQuery ? '검색 결과가 없습니다' : (tabEmptyMsg[activeTab] || '아직 저장된 형광펜이 없습니다');
        const emptyIcon = state.searchQuery ? 'search' : 'book-open';
        $container.html(`
            <div class="hl-empty">
                <div class="hl-empty-icon"><i class="fa-solid fa-${emptyIcon}"></i></div>
                <div class="hl-empty-text">${emptyMsg}</div>
            </div>
        `);
        return;
    }

    // 정렬
    const sortOption = state.settings.sortOptions?.characters || 'modified';
    const sortDir = state.settings.sortOptions?.directions?.characters || 'desc';
    const dirMul = sortDir === 'asc' ? -1 : 1;
    if (sortOption === 'name') {
        // 이름순 (가나다)
        charIds.sort((a, b) => {
            const nameA = getCharacterNameByKey(a);
            const nameB = getCharacterNameByKey(b);
            const cmp = nameA.localeCompare(nameB, 'ko-KR');
            return sortDir === 'asc' ? cmp : -cmp;
        });
    } else {
        // 최근 수정순
        charIds.sort((a, b) => {
            const chatsA = state.settings.highlights[a] || {};
            const chatsB = state.settings.highlights[b] || {};
            const bmChatsA = state.settings.bookmarks?.[a] || {};
            const bmChatsB = state.settings.bookmarks?.[b] || {};
            const hlModA = Object.values(chatsA).length ? Math.max(...Object.values(chatsA).map(c => c.lastModified || 0)) : 0;
            const hlModB = Object.values(chatsB).length ? Math.max(...Object.values(chatsB).map(c => c.lastModified || 0)) : 0;
            const bmModA = Object.values(bmChatsA).length ? Math.max(...Object.values(bmChatsA).map(c => c.lastModified || 0)) : 0;
            const bmModB = Object.values(bmChatsB).length ? Math.max(...Object.values(bmChatsB).map(c => c.lastModified || 0)) : 0;
            const lastModifiedA = Math.max(hlModA, bmModA);
            const lastModifiedB = Math.max(hlModB, bmModB);
            return (lastModifiedB - lastModifiedA) * dirMul;
        });
    }

    let htmlParts = [];
    charIds.forEach(charKey => {
        const charName = getCharacterNameByKey(charKey);
        const totalHighlights = getTotalHighlightsForCharacter(charKey);
        const totalNotes = getTotalNotesForCharacter(charKey);
        const totalBookmarks = getTotalBookmarksForCharacter(charKey);
        const memo = state.settings.characterMemos?.[charKey] || '';
        const memoDisplay = memo ? `<span class="hl-memo">${highlightSearchMatch(memo)}</span>` : '';

        // 탭에 맞는 개수 표시
        let countLabel;
                if (activeTab === 'bookmarks') countLabel = `${totalBookmarks}개`;
                else if (activeTab === 'notes') countLabel = `${totalNotes}개`;
                else if (activeTab === 'highlights') countLabel = `${totalHighlights}개`;
                else countLabel = `${totalHighlights}개`;

                const bookmarkBadge = activeTab === 'all' && totalBookmarks > 0
                    ? `<span class="hl-count hl-bookmark-count">책갈피 ${totalBookmarks}개</span>` : '';
        let avatarHtml;
        let isGroup = false;
        if (isGroupKey(charKey)) {
            isGroup = true;
            const groupId = getGroupIdFromKey(charKey);
            const group = findGroupById(groupId);
            avatarHtml = buildGroupAvatarHtml(group);
        } else {
            const charData = findCharacterByKey(charKey);
            if (charData?.avatar) {
                const avatarSrc = `/thumbnail?file=${encodeURIComponent(charData.avatar)}&type=avatar`;
                avatarHtml = `<img src="${avatarSrc}" class="hl-icon" loading="eager">`;
            } else {
                avatarHtml = '<div class="hl-icon hl-default-avatar"><i class="fa-solid fa-user"></i></div>';
            }
        }

        const groupBadge = isGroup ? '<span class="hl-group-badge" title="그룹 채팅"><i class="fa-solid fa-users"></i></span>' : '';

        htmlParts.push(`
            <div class="hl-list-item" data-char-key="${charKey}">
                ${avatarHtml}
                <div class="hl-info">
                    <div class="hl-name">${groupBadge}${highlightSearchMatch(charName)}</div>
                    <div class="hl-count-row">
                        <span class="hl-count">${countLabel}</span>
                        ${bookmarkBadge}
                        ${memoDisplay}
                    </div>
                </div>
                <button class="hl-memo-edit-btn" data-char-key="${charKey}" title="메모 편집">
                    <i class="fa-solid fa-pencil"></i>
                </button>
                <i class="fa-solid fa-chevron-right hl-chevron"></i>
            </div>
        `);
    });
    $container.append(htmlParts.join(''));

    // 아바타 이미지 처리 (selector 캐싱)
    const $icons = $container.find('img.hl-icon');
    $icons.on('error', function () {
        const isGroup = $(this).hasClass('hl-group-avatar');
        const icon = isGroup ? 'fa-users' : 'fa-user';
        $(this).replaceWith(`<div class="hl-icon hl-default-avatar"><i class="fa-solid ${icon}"></i></div>`);
    });
    // 기본 아바타(ai4.png) 감지 → 아이콘으로 교체
    const checkDefaultAvatar = (img) => {
        if (!img.parentNode) return; // DOM에서 제거된 경우 스킵
        const doReplace = () => {
            if (img.parentNode && isDefaultAvatarImage(img)) {
                $(img).replaceWith('<div class="hl-icon hl-default-avatar"><i class="fa-solid fa-user"></i></div>');
            }
        };
        // 모바일에서 load 이벤트 후에도 이미지 디코딩이 완료되지 않았을 수 있음
        if (img.decode) {
            img.decode().then(doReplace).catch(() => {});
        } else {
            doReplace();
        }
    };
    const waitAndCheck = (img) => {
        if (state.defaultAvatarPixels) {
            checkDefaultAvatar(img);
        } else if (state.defaultAvatarReady) {
            state.defaultAvatarReady.then(() => checkDefaultAvatar(img));
        }
    };
    $icons.on('load', function () {
        waitAndCheck(this);
    });
    // 이미 로드 완료/실패한 이미지 처리 (타이밍 문제 대응)
    $icons.each(function () {
        if (this.complete) {
            if (this.naturalWidth === 0) {
                const isGroup = $(this).hasClass('hl-group-avatar');
                const icon = isGroup ? 'fa-users' : 'fa-user';
                $(this).replaceWith(`<div class="hl-icon hl-default-avatar"><i class="fa-solid ${icon}"></i></div>`);
            } else {
                waitAndCheck(this);
            }
        }
    });
    // 콜라주 멤버 이미지 로드 실패 시 숨김
    $container.find('.hl-collage-img').on('error', function () {
        $(this).hide();
    });
}

// ====================================
// 채팅 목록 렌더링
// ====================================

export function renderChatList($container, characterId, activeTab) {
    // 기존 내용 초기화
    $container.empty();

    const chats = state.settings.highlights[characterId] || {};
    const bookmarkChats = state.settings.bookmarks?.[characterId] || {};
    // 탭 필터에 맞는 채팅 파일 수집
    const chatFileSet = new Set();
    if (activeTab === 'bookmarks') {
        Object.keys(bookmarkChats).forEach(cf => { if (bookmarkChats[cf].bookmarks?.length > 0) chatFileSet.add(cf); });
    } else if (activeTab === 'notes') {
        Object.keys(chats).forEach(cf => {
            if (chats[cf].highlights?.some(h => h.note && h.note.trim())) chatFileSet.add(cf);
        });
    } else if (activeTab === 'highlights') {
        Object.keys(chats).forEach(cf => { if (chats[cf].highlights?.length > 0) chatFileSet.add(cf); });
    } else {
        // 전체
        Object.keys(chats).forEach(cf => { if (chats[cf].highlights?.length > 0) chatFileSet.add(cf); });
        Object.keys(bookmarkChats).forEach(cf => { if (bookmarkChats[cf].bookmarks?.length > 0) chatFileSet.add(cf); });
    }
    let chatFiles = [...chatFileSet];

    // 검색 필터
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        const cat = state.searchCategory;
        chatFiles = chatFiles.filter(chatFile => {
            const chatName = chatFile.toLowerCase();
            const memoKey = `${characterId}_${chatFile}`;
            const memo = (state.settings.chatMemos?.[memoKey] || '').toLowerCase();
            const chatHighlights = chats[chatFile]?.highlights || [];
            const hasHighlight = chatHighlights.some(h => h.text.toLowerCase().includes(q));
            const hasNote = chatHighlights.some(h => (h.note || '').toLowerCase().includes(q));
            const hasBookmark = (bookmarkChats[chatFile]?.bookmarks || []).some(b =>
                (b.preview || '').toLowerCase().includes(q) || (b.label || '').toLowerCase().includes(q)
            );

            if (cat === 'character') return false;
            if (cat === 'chat') return chatName.includes(q) || memo.includes(q);
            if (cat === 'highlight') return hasHighlight;
            if (cat === 'note') return hasNote;
            // all
            return chatName.includes(q) || memo.includes(q) || hasHighlight || hasNote || hasBookmark;
        });
    }

    if (chatFiles.length === 0) {
        const tabEmptyMsg = { bookmarks: '책갈피가 없습니다', notes: '메모가 없습니다', highlights: '형광펜이 없습니다' };
        const emptyMsg = state.searchQuery ? '검색 결과가 없습니다' : (tabEmptyMsg[activeTab] || '형광펜이 없습니다');
        const emptyIcon = state.searchQuery ? 'search' : 'message';
        $container.html(`
            <div class="hl-empty">
                <div class="hl-empty-icon"><i class="fa-solid fa-${emptyIcon}"></i></div>
                <div class="hl-empty-text">${emptyMsg}</div>
            </div>
        `);
        return;
    }

    // "모든 형광펜 보기" 버튼 (검색 중이 아닐 때만, 책갈피 탭이 아닐 때만 표시)
    if (!state.searchQuery && activeTab !== 'bookmarks') {
        let allBtnLabel, allBtnCount;
        if (activeTab === 'notes') {
            allBtnLabel = '모든 메모 보기';
            allBtnCount = getTotalNotesForCharacter(characterId);
        } else {
            allBtnLabel = '모든 형광펜 보기';
            allBtnCount = getTotalHighlightsForCharacter(characterId);
        }
        const allBtn = `
            <div class="hl-all-highlights-btn" id="hl-view-all-highlights">
                <i class="fa-solid fa-layer-group"></i>
                <span>${allBtnLabel}</span>
                <span class="hl-all-highlights-count">${allBtnCount}개</span>
            </div>
        `;
        $container.append(allBtn);
    }

    // 정렬
    const sortOption = state.settings.sortOptions?.chats || 'modified';
    const sortDir = state.settings.sortOptions?.directions?.chats || 'desc';
    if (sortOption === 'name') {
        // 이름순 (가나다)
        chatFiles.sort((a, b) => {
            const cmp = a.localeCompare(b, 'ko-KR');
            return sortDir === 'asc' ? cmp : -cmp;
        });
    } else {
        // 최근 수정순
        chatFiles.sort((a, b) => {
            const lastModifiedA = Math.max(chats[a]?.lastModified || 0, bookmarkChats[a]?.lastModified || 0);
            const lastModifiedB = Math.max(chats[b]?.lastModified || 0, bookmarkChats[b]?.lastModified || 0);
            return sortDir === 'asc'
                ? lastModifiedA - lastModifiedB
                : lastModifiedB - lastModifiedA;
        });
    }

    let htmlParts = [];
    chatFiles.forEach(chatFile => {
        const chatData = chats[chatFile];
        const hlCount = chatData?.highlights?.length || 0;
        const noteCount = (chatData?.highlights || []).filter(h => h.note && h.note.trim()).length;
        const bmCount = bookmarkChats[chatFile]?.bookmarks?.length || 0;

        // 탭에 맞는 개수 표시
        let displayCount, countLabel;
                if (activeTab === 'bookmarks') { displayCount = bmCount; countLabel = `${bmCount}개`; }
                else if (activeTab === 'notes') { displayCount = noteCount; countLabel = `${noteCount}개`; }
                else if (activeTab === 'highlights') { displayCount = hlCount; countLabel = `${hlCount}개`; }
                else { displayCount = hlCount; countLabel = `${hlCount}개`; }

                // 탭에 맞는 배지 표시
                const bookmarkBadge = activeTab === 'all' && bmCount > 0
                    ? `<span class="hl-count hl-bookmark-count">책갈피 ${bmCount}개</span>` : '';
        // 프리뷰 텍스트
        let preview = '';
        if (hlCount > 0) {
            const latest = chatData.highlights.reduce((prev, current) => {
                return (current.timestamp > prev.timestamp) ? current : prev;
            });
            if (latest) {
                let previewText = latest.text;
                if (state.settings.translatorCompat && latest.sourceType) {
                    const pref = state.settings.translatorPanelDisplay || 'translated';
                    if (latest.sourceType === 'translated' && pref === 'original' && latest.translatorOriginalText) {
                        previewText = latest.translatorOriginalText;
                    } else if (latest.sourceType === 'original' && pref === 'translated' && latest.translatedText) {
                        previewText = latest.translatedText;
                    }
                }
                preview = previewText.substring(0, 50) + (previewText.length > 50 ? '...' : '');
            }
        } else if (bmCount > 0) {
            const latestBm = bookmarkChats[chatFile].bookmarks[bookmarkChats[chatFile].bookmarks.length - 1];
            preview = latestBm?.preview?.substring(0, 50) || '';
        }
        const memoKey = `${characterId}_${chatFile}`;
        const memo = state.settings.chatMemos?.[memoKey] || '';
        const memoDisplay = memo ? `<span class="hl-memo">${highlightSearchMatch(memo)}</span>` : '';

        htmlParts.push(`
            <div class="hl-list-item" data-chat-file="${chatFile}">
                <div class="hl-chat-icon">
                    <i class="fa-solid fa-message"></i>
                </div>
                <div class="hl-info">
                    <div class="hl-name">${highlightSearchMatch(chatFile)}</div>
                    <div class="hl-count-row">
                        <span class="hl-count">${countLabel}</span>
                        ${bookmarkBadge}
                        ${memoDisplay}
                    </div>
                    <div class="hl-preview">${highlightSearchMatch(preview)}</div>
                </div>
                <button class="hl-memo-edit-btn" data-char-id="${characterId}" data-chat-file="${chatFile}" title="메모 편집">
                    <i class="fa-solid fa-pencil"></i>
                </button>
                <i class="fa-solid fa-chevron-right hl-chevron"></i>
            </div>
        `);
    });
    $container.append(htmlParts.join(''));
}

// ====================================
// 형광펜 목록 렌더링
// ====================================

export function renderHighlightList($container, characterId, chatFile, activeTab) {
    // 기존 내용 초기화
    $container.empty();

    // 책갈피 탭은 별도 렌더링
    if (activeTab === 'bookmarks') {
        renderBookmarkItems($container, characterId, chatFile);
        return;
    }

    // 캐릭터 전체 형광펜 보기 모드 (chatFile === null)
    const isAllMode = !chatFile;
    let highlights;

    if (isAllMode) {
        // 모든 채팅의 형광펜 병합
        highlights = [];
        const chats = state.settings.highlights[characterId];
        if (chats) {
            Object.entries(chats).forEach(([cf, chatData]) => {
                if (chatData?.highlights) {
                    chatData.highlights.forEach(h => {
                        highlights.push({ ...h, _chatFile: cf });
                    });
                }
            });
        }
    } else {
        highlights = (state.settings.highlights[characterId]?.[chatFile]?.highlights || []).map(h => ({ ...h, _chatFile: chatFile }));
    }

    let filtered = activeTab === 'notes' ?
        highlights.filter(h => h.note && h.note.trim()) :
        highlights;

    // 검색 필터
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        const cat = state.searchCategory;
        filtered = filtered.filter(h => {
            if (cat === 'character') return false;
            if (cat === 'chat') {
                // 전체 형광펜 모드에서는 채팅 파일명으로 필터
                return isAllMode ? (h._chatFile || '').toLowerCase().includes(q) : false;
            }
            if (cat === 'highlight') return h.text.toLowerCase().includes(q);
            if (cat === 'note') return (h.note || '').toLowerCase().includes(q);
            // all
            const textMatch = h.text.toLowerCase().includes(q) || (h.note || '').toLowerCase().includes(q);
            return isAllMode ? (textMatch || (h._chatFile || '').toLowerCase().includes(q)) : textMatch;
        });
    }

    // 전체 탭: 책갈피도 로드
    let filteredBookmarks = [];
    if (activeTab === 'all') {
        filteredBookmarks = getBookmarksForView(characterId, chatFile);
        if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase();
            filteredBookmarks = filteredBookmarks.filter(b =>
                (b.preview || '').toLowerCase().includes(q) ||
                (b.label || '').toLowerCase().includes(q)
            );
        }
    }

    if (filtered.length === 0 && filteredBookmarks.length === 0) {
        const msg = state.searchQuery ? '검색 결과가 없습니다' : (activeTab === 'notes' ? '메모가 없습니다' : '형광펜이 없습니다');
        const emptyIcon = state.searchQuery ? 'search' : 'highlighter';
        $container.html(`
            <div class="hl-empty">
                <div class="hl-empty-icon"><i class="fa-solid fa-${emptyIcon}"></i></div>
                <div class="hl-empty-text">${msg}</div>
            </div>
        `);
        return;
    }

    // 정렬
    const sortOption = state.settings.sortOptions?.highlights || 'created';
    const sortDir = state.settings.sortOptions?.directions?.highlights || 'desc';

    // 전체 탭: 형광펜+책갈피 통합 정렬
    if (activeTab === 'all' && filteredBookmarks.length > 0) {
        // 타입 태그 추가
        filtered.forEach(h => h._itemType = 'highlight');
        filteredBookmarks.forEach(b => b._itemType = 'bookmark');
        const combined = [...filtered, ...filteredBookmarks];

        // 통합 정렬
        sortItemList(combined, sortOption, sortDir, isAllMode);

        // 통합 렌더링
        renderCombinedItems($container, combined, characterId);
        return;
    }

    // 형광펜만 정렬
    sortItemList(filtered, sortOption, sortDir, isAllMode);

    let htmlParts = [];
    filtered.forEach(hl => {
        const date = new Date(hl.timestamp).toLocaleDateString('ko-KR');
        // ⭐ 수정: 저장된 라벨이 있으면 사용, 없으면 현재 chat으로부터 가져오기 (하위 호환성)
        const label = hl.label || getMessageLabel(hl.mesId);

        // ⭐ 동적 색상 적용: Slot ID가 있으면 현재 프리셋의 해당 슬롯 색상 사용
        let displayColor = hl.color;
        if (hl.colorIndex !== undefined) {
            const currentColors = getColors();
            if (currentColors[hl.colorIndex]) {
                displayColor = currentColors[hl.colorIndex].bg;
            }
        }

        // LLM 번역기 호환: 패널 표시 텍스트 결정
        let displayText = hl.text;
        let altText = null;
        let altLabel = '';
        let altField = '';
        if (state.settings.translatorCompat && hl.sourceType) {
            const pref = state.settings.translatorPanelDisplay || 'translated';
            if (hl.sourceType === 'translated' && pref === 'original' && hl.translatorOriginalText) {
                displayText = hl.translatorOriginalText;
                if (state.settings.translatorShowAltText !== false) {
                    altText = hl.text;
                    altLabel = '번역문';
                    altField = 'text';
                }
            } else if (hl.sourceType === 'original' && pref === 'translated' && hl.translatedText) {
                displayText = hl.translatedText;
                if (state.settings.translatorShowAltText !== false) {
                    altText = hl.text;
                    altLabel = '원문';
                    altField = 'text';
                }
            } else if (hl.sourceType === 'translated' && hl.translatorOriginalText) {
                if (state.settings.translatorShowAltText !== false) {
                    altText = hl.translatorOriginalText;
                    altLabel = '원문';
                    altField = 'translatorOriginalText';
                }
            } else if (hl.sourceType === 'original' && hl.translatedText) {
                if (state.settings.translatorShowAltText !== false) {
                    altText = hl.translatedText;
                    altLabel = '번역문';
                    altField = 'translatedText';
                }
            }
        }

        const translatorToggleHtml = altText
            ? `<div class="hl-translator-toggle">▸ ${altLabel}</div><div class="hl-translator-alt" style="display:none">${highlightSearchMatch(altText)}</div>`
            : '';

        htmlParts.push(`
            <div class="hl-highlight-item" style="--highlight-color: ${displayColor}" data-mes-id="${hl.mesId}" data-hl-id="${hl.id}" data-chat-file="${hl._chatFile || ''}" data-alt-field="${altField || ''}">
                <div class="hl-content${altText ? ' hl-has-translator' : ''}">
                    <div class="hl-text">${highlightSearchMatch(displayText)}</div>
                    ${translatorToggleHtml}
                    ${hl.note ? `<div class="hl-note"><i class="fa-solid fa-note-sticky"></i><span>${highlightSearchMatch(hl.note)}</span></div>` : ''}
                    <div class="hl-meta">
                        <span>${label}</span>
                        <span style="opacity: 0.5">|</span>
                        <span>${date}</span>
                    </div>
                </div>
                <div class="hl-actions">
                    <button class="hl-more-btn hl-item-more-btn" data-mes-id="${hl.mesId}" data-hl-id="${hl.id}" title="더보기">⋮</button>
                </div>
            </div>
        `);
    });
    $container.append(htmlParts.join(''));
}

// ====================================
// 책갈피 렌더링
// ====================================

/**
 * 책갈피 전용 탭 렌더링
 */
function renderBookmarkItems($container, characterId, chatFile) {
    const isAllMode = !chatFile;
    let bookmarks = getBookmarksForView(characterId, chatFile);

    // 검색 필터
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        bookmarks = bookmarks.filter(b =>
            (b.preview || '').toLowerCase().includes(q) ||
            (b.label || '').toLowerCase().includes(q) ||
            (isAllMode ? (b._chatFile || '').toLowerCase().includes(q) : false)
        );
    }

    if (bookmarks.length === 0) {
        const msg = state.searchQuery ? '검색 결과가 없습니다' : '책갈피가 없습니다';
        const emptyIcon = state.searchQuery ? 'search' : 'bookmark';
        $container.html(`
            <div class="hl-empty">
                <div class="hl-empty-icon"><i class="fa-solid fa-${emptyIcon}"></i></div>
                <div class="hl-empty-text">${msg}</div>
            </div>
        `);
        return;
    }

    // 정렬
    const sortOption = state.settings.sortOptions?.highlights || 'created';
    const sortDir = state.settings.sortOptions?.directions?.highlights || 'desc';
    sortItemList(bookmarks, sortOption, sortDir, isAllMode);

    appendBookmarkItems($container, bookmarks, characterId);
}

/**
 * 책갈피 아이템들을 컨테이너에 추가 (공용)
 */
function appendBookmarkItems($container, bookmarks, characterId) {
    const currentChatFile = getCurrentChatFile();
    let htmlParts = [];
    bookmarks.forEach(bm => {
        const date = new Date(bm.timestamp).toLocaleDateString('ko-KR');
        const label = bm.label || `메시지#${bm.mesId}`;
        let preview;
        if (bm._chatFile === currentChatFile || !bm._chatFile) {
            const freshPreview = getMessagePreview(bm.mesId);
            preview = freshPreview || cleanStoredPreview(bm.preview);
        } else {
            preview = cleanStoredPreview(bm.preview);
        }
        const safePreview = escapeHtml(preview);

        htmlParts.push(`
            <div class="hl-bookmark-item" data-mes-id="${bm.mesId}" data-bm-id="${bm.id}" data-chat-file="${bm._chatFile || ''}" data-char-id="${characterId}">
                <div class="hl-content">
                    <div class="hl-text">${highlightSearchMatch(safePreview)}</div>
                    ${bm.note ? `<div class="hl-note"><i class="fa-solid fa-note-sticky"></i><span>${highlightSearchMatch(escapeHtml(bm.note))}</span></div>` : ''}
                    <div class="hl-meta">
                        <span>${label}</span>
                        <span>|</span>
                        <span>${date}</span>
                    </div>
                </div>
                <div class="hl-actions">
                    <button class="hl-more-btn hl-bookmark-more-btn" data-bm-id="${bm.id}" data-chat-file="${bm._chatFile || ''}" data-char-id="${characterId}" data-mes-id="${bm.mesId}" title="더보기">⋮</button>
                </div>
            </div>
        `);
    });
    $container.append(htmlParts.join(''));
}

// ====================================
// 정렬 / 통합 렌더링
// ====================================

/**
 * 공용 정렬 함수 (형광펜/책갈피 통합 정렬)
 */
function sortItemList(items, sortOption, sortDir, isAllMode) {
    if (isAllMode && sortOption === 'message') {
        items.sort((a, b) => {
            if (a._chatFile !== b._chatFile) {
                const cmp = (a._chatFile || '').localeCompare(b._chatFile || '', 'ko-KR');
                return sortDir === 'asc' ? cmp : -cmp;
            }
            if (a.mesId !== b.mesId) {
                return sortDir === 'asc' ? a.mesId - b.mesId : b.mesId - a.mesId;
            }
            if (a.textOffset !== undefined && b.textOffset !== undefined) {
                return sortDir === 'asc' ? a.textOffset - b.textOffset : b.textOffset - a.textOffset;
            }
            return sortDir === 'asc'
                ? (a.timestamp || 0) - (b.timestamp || 0)
                : (b.timestamp || 0) - (a.timestamp || 0);
        });
    } else if (sortOption === 'message') {
        items.sort((a, b) => {
            if (a.mesId !== b.mesId) {
                return sortDir === 'asc' ? a.mesId - b.mesId : b.mesId - a.mesId;
            }
            if (a.textOffset !== undefined && b.textOffset !== undefined) {
                return sortDir === 'asc' ? a.textOffset - b.textOffset : b.textOffset - a.textOffset;
            }
            return sortDir === 'asc'
                ? (a.timestamp || 0) - (b.timestamp || 0)
                : (b.timestamp || 0) - (a.timestamp || 0);
        });
    } else {
        items.sort((a, b) => sortDir === 'asc'
            ? (a.timestamp || 0) - (b.timestamp || 0)
            : (b.timestamp || 0) - (a.timestamp || 0));
    }
}

/**
 * 형광펜+책갈피 통합 렌더링 (전체 탭용)
 */
function renderCombinedItems($container, items, characterId) {
    const currentChatFile = getCurrentChatFile();
    let htmlParts = [];

    items.forEach(item => {
        if (item._itemType === 'bookmark') {
            const bm = item;
            const date = new Date(bm.timestamp).toLocaleDateString('ko-KR');
            const label = bm.label || `메시지#${bm.mesId}`;
            let preview;
            if (bm._chatFile === currentChatFile || !bm._chatFile) {
                const freshPreview = getMessagePreview(bm.mesId);
                preview = freshPreview || cleanStoredPreview(bm.preview);
            } else {
                preview = cleanStoredPreview(bm.preview);
            }
            const safePreview = escapeHtml(preview);
            htmlParts.push(`
                <div class="hl-bookmark-item" data-mes-id="${bm.mesId}" data-bm-id="${bm.id}" data-chat-file="${bm._chatFile || ''}" data-char-id="${characterId}">
                    <div class="hl-content">
                        <div class="hl-text">${highlightSearchMatch(safePreview)}</div>
                        ${bm.note ? `<div class="hl-note"><i class="fa-solid fa-note-sticky"></i><span>${highlightSearchMatch(escapeHtml(bm.note))}</span></div>` : ''}
                        <div class="hl-meta">
                            <span>${label}</span>
                            <span>|</span>
                            <span>${date}</span>
                        </div>
                    </div>
                    <div class="hl-actions">
                        <button class="hl-more-btn hl-bookmark-more-btn" data-bm-id="${bm.id}" data-chat-file="${bm._chatFile || ''}" data-char-id="${characterId}" data-mes-id="${bm.mesId}" title="더보기">⋮</button>
                    </div>
                </div>
            `);
        } else {
            const hl = item;
            const date = new Date(hl.timestamp).toLocaleDateString('ko-KR');
            const label = hl.label || getMessageLabel(hl.mesId);
            let displayColor = hl.color;
            if (hl.colorIndex !== undefined) {
                const currentColors = getColors();
                if (currentColors[hl.colorIndex]) {
                    displayColor = currentColors[hl.colorIndex].bg;
                }
            }

            // LLM 번역기 호환: 패널 표시 텍스트 결정
            let displayText = hl.text;
            let altText = null;
            let altLabel = '';
            let altField = '';
            if (state.settings.translatorCompat && hl.sourceType) {
                const pref = state.settings.translatorPanelDisplay || 'translated';
                if (hl.sourceType === 'translated' && pref === 'original' && hl.translatorOriginalText) {
                    displayText = hl.translatorOriginalText;
                    if (state.settings.translatorShowAltText !== false) {
                        altText = hl.text;
                        altLabel = '번역문';
                        altField = 'text';
                    }
                } else if (hl.sourceType === 'original' && pref === 'translated' && hl.translatedText) {
                    displayText = hl.translatedText;
                    if (state.settings.translatorShowAltText !== false) {
                        altText = hl.text;
                        altLabel = '원문';
                        altField = 'text';
                    }
                } else if (hl.sourceType === 'translated' && hl.translatorOriginalText) {
                    if (state.settings.translatorShowAltText !== false) {
                        altText = hl.translatorOriginalText;
                        altLabel = '원문';
                        altField = 'translatorOriginalText';
                    }
                } else if (hl.sourceType === 'original' && hl.translatedText) {
                    if (state.settings.translatorShowAltText !== false) {
                        altText = hl.translatedText;
                        altLabel = '번역문';
                        altField = 'translatedText';
                    }
                }
            }

            const translatorToggleHtml = altText
                ? `<div class="hl-translator-toggle">▸ ${altLabel}</div><div class="hl-translator-alt" style="display:none">${highlightSearchMatch(altText)}</div>`
                : '';

            htmlParts.push(`
                <div class="hl-highlight-item" style="--highlight-color: ${displayColor}" data-mes-id="${hl.mesId}" data-hl-id="${hl.id}" data-chat-file="${hl._chatFile || ''}" data-alt-field="${altField || ''}">
                    <div class="hl-content${altText ? ' hl-has-translator' : ''}">
                        <div class="hl-text">${highlightSearchMatch(displayText)}</div>
                        ${translatorToggleHtml}
                        ${hl.note ? `<div class="hl-note"><i class="fa-solid fa-note-sticky"></i><span>${highlightSearchMatch(hl.note)}</span></div>` : ''}
                        <div class="hl-meta">
                            <span>${label}</span>
                            <span>|</span>
                            <span>${date}</span>
                        </div>
                    </div>
                    <div class="hl-actions">
                        <button class="hl-more-btn hl-item-more-btn" data-mes-id="${hl.mesId}" data-hl-id="${hl.id}" title="더보기">⋮</button>
                    </div>
                </div>
            `);
        }
    });
    $container.append(htmlParts.join(''));
}
