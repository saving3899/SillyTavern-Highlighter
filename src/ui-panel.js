import { saveSettingsDebounced } from '../../../../../script.js';
import { state } from './state.js';
import { extensionName, EXT_PATHS, VIEW_LEVELS } from './constants.js';
import { initCharacterCache } from './character-keys.js';
import { enableHighlightMode, disableHighlightMode } from './highlight-mode.js';

// 순환 참조 방지용 콜백
let _renderView = null;
let _showHeaderMoreMenu = null;
let _importHighlights = null;
let _showHighlightContextMenu = null;
let _navigateToChatList = null;
let _navigateToHighlightList = null;
let _openCharacterMemoEditor = null;
let _openChatMemoEditor = null;
let _jumpToMessage = null;
let _showHighlightItemMoreMenu = null;
let _showBookmarkItemMoreMenu = null;

export function initUiPanelCallbacks(
    renderViewFn,
    showHeaderMoreMenuFn,
    importHighlightsFn,
    showHighlightContextMenuFn,
    navigateToChatListFn,
    navigateToHighlightListFn,
    openCharacterMemoEditorFn,
    openChatMemoEditorFn,
    jumpToMessageFn,
    showHighlightItemMoreMenuFn,
    showBookmarkItemMoreMenuFn,
) {
    _renderView = renderViewFn;
    _showHeaderMoreMenu = showHeaderMoreMenuFn;
    _importHighlights = importHighlightsFn;
    _showHighlightContextMenu = showHighlightContextMenuFn;
    _navigateToChatList = navigateToChatListFn;
    _navigateToHighlightList = navigateToHighlightListFn;
    _openCharacterMemoEditor = openCharacterMemoEditorFn;
    _openChatMemoEditor = openChatMemoEditorFn;
    _jumpToMessage = jumpToMessageFn;
    _showHighlightItemMoreMenu = showHighlightItemMoreMenuFn;
    _showBookmarkItemMoreMenu = showBookmarkItemMoreMenuFn;
}

// ====================================
// 확장 폴더 경로
// ====================================

export async function getExtensionFolderPath() {
    for (const path of EXT_PATHS) {
        try {
            await $.get(`${path}/settings.html`); // 존재 확인용
            return path;
        } catch {
            continue;
        }
    }
    console.warn(`[SillyTavern-Highlighter] Could not locate extension folder for "${extensionName}".`);
    return EXT_PATHS[0]; // 기본값
}

// ====================================
// 요술봉 메뉴
// ====================================

// 요술봉 메뉴에 버튼 추가
export async function addToWandMenu() {
    try {
        const extensionFolderPath = await getExtensionFolderPath();
        const buttonHtml = await $.get(`${extensionFolderPath}/button.html`);

        const extensionsMenu = $("#extensionsMenu");
        if (extensionsMenu.length > 0) {
            // 기존 버튼이 있으면 제거 후 추가
            $("#highlighter_wand_button, #highlighter_panel_button").remove();

            extensionsMenu.append(buttonHtml);

            // 형광펜 모드 버튼 클릭 이벤트
            $("#highlighter_wand_button").on("click", function () {
                toggleHighlightMode();
            });

            // 독서노트 패널 버튼 클릭 이벤트
            $("#highlighter_panel_button").on("click", function () {
                openPanel();
            });

            // 설정에 따라 표시/숨김
            updateWandMenuVisibility();
        } else {
            setTimeout(addToWandMenu, 1000);
        }
    } catch (error) {
        // 버튼 로드 실패시 재시도
        setTimeout(addToWandMenu, 1000);
    }
}

// 요술봉 메뉴 버튼 표시/숨김
export function updateWandMenuVisibility() {
    if (state.settings.showWandButton) {
        $("#highlighter_wand_button, #highlighter_panel_button").show();
    } else {
        $("#highlighter_wand_button, #highlighter_panel_button").hide();
    }
}

// ====================================
// 패널 UI 생성
// ====================================

export function createHighlighterUI() {
    const icon = state.settings.floatingBtnIcon || 'fa-bars';
    const html = `
        <div id="highlighter-floating-container">
            <button id="highlighter-toggle-btn" title="메뉴 열기">
                <i class="fa-solid ${icon}"></i>
            </button>
            <div id="highlighter-floating-menu" class="hl-floating-menu" style="display: none;">
                <button class="hl-floating-menu-btn" id="hl-floating-panel-btn" title="독서노트 열기">
                    <i class="fa-solid fa-book"></i>
                </button>
                <button class="hl-floating-menu-btn" id="hl-floating-highlight-mode-btn" title="형광펜 모드">
                    <i class="fa-solid fa-highlighter"></i>
                </button>
            </div>
        </div>

        <div id="highlighter-panel">
            <div class="highlighter-header">
                <div class="highlighter-title">
                    <i class="fa-solid fa-book"></i>
                    독서노트
                </div>
                <div class="highlighter-actions">
                    <button class="highlighter-btn" id="hl-header-more-btn" title="더보기">
                        <i class="fa-solid fa-ellipsis-vertical"></i>
                    </button>
                    <button class="highlighter-btn" id="hl-close-btn" title="닫기">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
            </div>

            <div class="highlighter-tabs">
                <button class="highlighter-tab active" data-tab="all">전체</button>
                <button class="highlighter-tab" data-tab="highlights">형광펜</button>
                <button class="highlighter-tab" data-tab="notes">메모</button>
                <button class="highlighter-tab" data-tab="bookmarks">책갈피</button>
            </div>

            <div class="highlighter-breadcrumb" id="highlighter-breadcrumb"></div>
            <div class="hl-search-bar" id="hl-search-bar" style="display:none;">
                <div class="hl-search-row">
                    <i class="fa-solid fa-search hl-search-icon"></i>
                    <input type="text" id="hl-search-input" class="hl-search-input" placeholder="검색" autocomplete="off">
                    <div class="hl-search-category-wrap">
                        <button class="hl-search-category-btn" id="hl-search-category-btn">전체</button>
                    </div>
                </div>
            </div>
            <div class="highlighter-content" id="highlighter-content"></div>
        </div>

        <input type="file" id="hl-import-file-input" accept=".json" style="display: none;">
    `;

    $('body').append(html);
    bindUIEvents();
    bindHighlightClickEvents(); // 하이라이트 클릭 이벤트 위임 설정
    bindContentDelegation(); // 패널 콘텐츠 이벤트 위임 설정
    applyDarkMode();
    applyButtonPosition();
}

// ====================================
// 이벤트 바인딩
// ====================================

function bindUIEvents() {
    $('#highlighter-toggle-btn').on('click', toggleFloatingMenu);
    $('#hl-floating-panel-btn').on('click', openPanel);
    $('#hl-floating-highlight-mode-btn').on('click', toggleHighlightMode);
    $('#hl-close-btn').on('click', closePanel);
    $('#hl-header-more-btn').on('click', (e) => _showHeaderMoreMenu(e));

    $('#hl-import-file-input').on('change', function (e) {
        const file = e.target.files[0];
        if (file) _importHighlights(file);
    });

    $('.highlighter-tab').on('click', function () {
        $('.highlighter-tab').removeClass('active');
        $(this).addClass('active');
        _renderView();
    });

    // 검색 입력 이벤트 (디바운싱)
    let searchTimer = null;
    $('#hl-search-input').on('input', function () {
        const val = $(this).val().trim();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.searchQuery = val;
            _renderView();
        }, 150);
    });
    // 검색 카테고리 드롭다운 이벤트
    $(document).on('click', '#hl-search-category-btn', function (e) {
        e.stopPropagation();
        let $menu = $('#hl-search-category-menu');
        if ($menu.length) {
            $menu.remove();
            return;
        }
        const menuHtml = `
            <div class="hl-search-category-menu ${getDarkModeClass()}" id="hl-search-category-menu">
                <div class="hl-search-category-item${state.searchCategory === 'all' ? ' active' : ''}" data-value="all">전체</div>
                <div class="hl-search-category-item${state.searchCategory === 'character' ? ' active' : ''}" data-value="character">캐릭터</div>
                <div class="hl-search-category-item${state.searchCategory === 'chat' ? ' active' : ''}" data-value="chat">채팅</div>
                <div class="hl-search-category-item${state.searchCategory === 'highlight' ? ' active' : ''}" data-value="highlight">형광펜</div>
                <div class="hl-search-category-item${state.searchCategory === 'note' ? ' active' : ''}" data-value="note">메모</div>
            </div>
        `;
        $('body').append(menuHtml);
        const rect = this.getBoundingClientRect();
        $('#hl-search-category-menu').css({
            top: (rect.bottom + 4) + 'px',
            right: (window.innerWidth - rect.right) + 'px',
            left: 'auto'
        });
    });
    $(document).on('click', '.hl-search-category-item', function (e) {
        e.stopPropagation();
        const val = $(this).data('value');
        state.searchCategory = val;
        $('#hl-search-category-btn').text($(this).text());
        $('#hl-search-category-menu').remove();
        if (state.searchQuery) _renderView();
    });
    $(document).on('click', function () {
        $('#hl-search-category-menu').remove();
    });

    if (window.innerWidth > 768) {
        bindDragFunctionality();
    }

    // 외부 클릭 시 플로팅 메뉴 닫기
    $(document).on('click', function (e) {
        const $floatingContainer = $('#highlighter-floating-container');
        const $floatingMenu = $('#highlighter-floating-menu');

        if (!$floatingContainer.is(e.target) && $floatingContainer.has(e.target).length === 0) {
            if ($floatingMenu.is(':visible')) {
                $floatingMenu.slideUp(200);
            }
        }
    });
}

// 하이라이트 클릭 이벤트를 이벤트 위임으로 바인딩 (패널 상태와 무관하게 작동)
function bindHighlightClickEvents() {
    // #chat 컨테이너에 이벤트 위임 설정
    $(document).on('click.hl', '.text-highlight', function (e) {
        e.stopPropagation();
        const hlId = $(this).data('hlId');
        if (hlId) {
            _showHighlightContextMenu(hlId, e.clientX, e.clientY);
        }
    });

    console.log('[SillyTavern-Highlighter] Click events bound with delegation');
}

/**
 * 패널 콘텐츠 영역 이벤트 위임 (한 번만 설정, 렌더마다 재바인딩 불필요)
 */
function bindContentDelegation() {
    const $content = $('#highlighter-content');

    // 목록 아이템 클릭 (캐릭터/채팅 네비게이션)
    $content.on('click', '.hl-list-item', function (e) {
        if ($(e.target).closest('.hl-memo-edit-btn').length) return;
        if (state.selectMode) return;
        if (state.currentView === VIEW_LEVELS.CHARACTER_LIST) {
            _navigateToChatList($(this).data('charKey'));
        } else if (state.currentView === VIEW_LEVELS.CHAT_LIST) {
            _navigateToHighlightList(state.selectedCharacter, $(this).data('chatFile'));
        }
    });

    // 메모 편집 버튼
    $content.on('click', '.hl-memo-edit-btn', function (e) {
        e.stopPropagation();
        if (state.selectMode) return;
        if (state.currentView === VIEW_LEVELS.CHARACTER_LIST) {
            _openCharacterMemoEditor($(this).data('charKey'));
        } else if (state.currentView === VIEW_LEVELS.CHAT_LIST) {
            _openChatMemoEditor($(this).data('charId'), $(this).data('chatFile'));
        }
    });

    // "모든 형광펜 보기" 버튼
    $content.on('click', '#hl-view-all-highlights', function () {
        _navigateToHighlightList(state.selectedCharacter, null);
    });

    // 형광펜 텍스트 클릭 → 메시지로 이동
    $content.on('click', '.hl-highlight-item .hl-text', function () {
        if (state.selectMode) return;
        const $item = $(this).closest('.hl-highlight-item');
        _jumpToMessage($item.data('mesId'), $item.data('hlId'));
    });

    // 번역문 토글
    $content.on('click', '.hl-translator-toggle', function (e) {
        e.stopPropagation();
        const $toggle = $(this);
        const $alt = $toggle.next('.hl-translator-alt');
        const isOpen = $alt.is(':visible');
        $alt.slideToggle(150);
        $toggle.text(isOpen ? $toggle.text().replace('▾', '▸') : $toggle.text().replace('▸', '▾'));
    });

    // 형광펜 더보기 버튼
    $content.on('click', '.hl-item-more-btn', function (e) {
        if (state.selectMode) return;
        e.stopPropagation();
        _showHighlightItemMoreMenu(e);
    });

    // 책갈피 텍스트 클릭 → 메시지로 이동
    $content.on('click', '.hl-bookmark-item .hl-text', function () {
        if (state.selectMode) return;
        const $item = $(this).closest('.hl-bookmark-item');
        _jumpToMessage($item.data('mesId'));
    });

    // 책갈피 더보기 버튼
    $content.on('click', '.hl-bookmark-more-btn', function (e) {
        if (state.selectMode) return;
        e.stopPropagation();
        _showBookmarkItemMoreMenu(e);
    });
}

// ====================================
// 패널 위치/드래그
// ====================================

/**
 * 패널 위치를 뷰포트 내로 클램핑 (debounce 래퍼)
 */
let _resizeTimer = null;
function debouncedClampPanel() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(clampPanelToViewport, 150);
}

/**
 * 패널 위치를 뷰포트 내로 클램핑
 */
function clampPanelToViewport() {
    const $panel = $('#highlighter-panel');
    if (!$panel.length || !$panel.hasClass('visible')) return;
    if (window.innerWidth <= 768) return; // 모바일은 별도 레이아웃

    const panel = $panel[0];
    const rect = panel.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = rect.width;
    const ph = rect.height;

    let left = rect.left;
    let top = rect.top;
    let changed = false;

    // 패널을 뷰포트 안에 완전히 보이도록 클램핑
    // 뷰포트가 패널보다 작으면 왼쪽/위 정렬
    if (left + pw > vw) {
        left = Math.max(0, vw - pw);
        changed = true;
    }
    if (left < 0) {
        left = 0;
        changed = true;
    }
    if (top + ph > vh) {
        top = Math.max(0, vh - ph);
        changed = true;
    }
    if (top < 0) {
        top = 0;
        changed = true;
    }

    if (changed) {
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.transform = 'none';
        state.settings.panelPosition = { top, left };
        saveSettingsDebounced();
    }
}

function bindDragFunctionality() {
    const $panel = $('#highlighter-panel');
    const $header = $('.highlighter-header');

    // 창 크기 변경 시 패널 위치 클램핑 (debounce로 성능 최적화)
    window.removeEventListener('resize', debouncedClampPanel);
    window.addEventListener('resize', debouncedClampPanel);

    $header.on('mousedown', function (e) {
        if ($(e.target).closest('.highlighter-btn').length) return;

        state.isDragging = true;
        $panel.addClass('dragging');

        const rect = $panel[0].getBoundingClientRect();
        state.dragOffsetX = e.clientX - rect.left;
        state.dragOffsetY = e.clientY - rect.top;

        // 기존 transform 제거하고 left/top으로 정규화
        const panel = $panel[0];
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.transform = 'none';

        e.preventDefault();
    });

    $(document).on('mousemove', function (e) {
        if (!state.isDragging) return;

        requestAnimationFrame(() => {
            const $panel = $('#highlighter-panel');
            const panel = $panel[0];

            // 목표 위치 계산
            let newLeft = e.clientX - state.dragOffsetX;
            let newTop = e.clientY - state.dragOffsetY;

            // 화면 경계 체크
            const maxX = window.innerWidth - $panel.width();
            const maxY = window.innerHeight - $panel.height();

            newLeft = Math.max(0, Math.min(newLeft, maxX));
            newTop = Math.max(0, Math.min(newTop, maxY));

            // left/top 직접 변경 (GPU 가속은 CSS의 will-change로 유지)
            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
        });
    });

    $(document).on('mouseup', function () {
        if (state.isDragging) {
            state.isDragging = false;
            const $panel = $('#highlighter-panel');
            $panel.removeClass('dragging');

            // 최종 위치 저장
            const rect = $panel[0].getBoundingClientRect();
            state.settings.panelPosition = {
                top: rect.top,
                left: rect.left
            };
            saveSettingsDebounced();
        }
    });
}

// ====================================
// 패널 열기/닫기
// ====================================

function toggleFloatingMenu() {
    const $menu = $('#highlighter-floating-menu');
    const isVisible = $menu.is(':visible');

    if (isVisible) {
        $menu.slideUp(200);
    } else {
        $menu.slideDown(200);
    }
}

export function openPanel() {
    const $panel = $('#highlighter-panel');

    // 플로팅 메뉴 닫기
    $('#highlighter-floating-menu').slideUp(200);

    // 패널 열기
    $panel.addClass('visible');

    // 저장된 위치가 있으면 복원 (모바일 제외)
    if (state.settings.panelPosition && window.innerWidth > 768) {
        $panel.css({
            top: state.settings.panelPosition.top + 'px',
            left: state.settings.panelPosition.left + 'px',
            right: 'auto',
            bottom: 'auto',
            transform: 'none'
        });
        // 뷰포트 밖으로 나감 방지
        requestAnimationFrame(() => clampPanelToViewport());
    }

    // 모바일에서 body 스크롤 방지
    if (window.innerWidth <= 768) {
        $('body').css('overflow', 'hidden');
    }

    // 스크롤 위치 초기화 (패널 재오픈 시)
    state.viewScrollPositions = {};
    $('.highlighter-content').scrollTop(0);

    // 데이터 변경이 없고 기존 콘텐츠가 있으면 재렌더링 스킵 (아바타 재로딩 방지)
    if (!state.panelContentDirty && $('#highlighter-content').children().length > 0) {
        return;
    }

    // 캐릭터 정보 캐시 초기화 (실시간 반영용)
    initCharacterCache();

    // 뷰 상태 초기화 (항상 캐릭터 목록에서 시작)
    state.currentView = VIEW_LEVELS.CHARACTER_LIST;
    state.selectedCharacter = null;
    state.selectedChat = null;

    // 탭 초기화 (항상 "전체" 탭에서 시작)
    $('.highlighter-tab').removeClass('active');
    $('.highlighter-tab[data-tab="all"]').addClass('active');

    _renderView();
    state.panelContentDirty = false;
}

export function closePanel() {
    $('#highlighter-panel').removeClass('visible');

    // 모바일에서 body 스크롤 복원
    if (window.innerWidth <= 768) {
        $('body').css('overflow', '');
    }
}

// ====================================
// 다크모드
// ====================================

export function toggleDarkMode() {
    state.settings.darkMode = !state.settings.darkMode;
    applyDarkMode();
    saveSettingsDebounced();
}

export function applyDarkMode() {
    const $panel = $('#highlighter-panel');
    const $settingsPanel = $('.highlighter-settings');

    if (state.settings.darkMode) {
        $panel.addClass('dark-mode');
        $settingsPanel.addClass('dark-mode');
    } else {
        $panel.removeClass('dark-mode');
        $settingsPanel.removeClass('dark-mode');
    }
}

export function getDarkModeClass() {
    return state.settings.darkMode ? 'dark-mode' : '';
}

// 플로팅 버튼 아이콘 변경
export function updateFloatingBtnIcon() {
    const icon = state.settings.floatingBtnIcon || 'fa-bars';
    const $icon = $('#highlighter-toggle-btn > i');
    if ($icon.length) {
        $icon.attr('class', `fa-solid ${icon}`);
    }
}

// ====================================
// 버튼 위치 / 형광펜 모드 토글
// ====================================

export function applyButtonPosition() {
    const $container = $('#highlighter-floating-container');

    // 플로팅 버튼 표시/숨김
    if (state.settings.showFloatingBtn === false) {
        $container.addClass('hidden');
        return;
    } else {
        $container.removeClass('hidden');
    }

    // 크기 적용 (CSS 변수)
    const sizeMap = { small: 36, medium: 48, large: 60 };
    const size = sizeMap[state.settings.floatingBtnSize] || 48;
    const subSize = Math.round(size * 0.83);
    const fontSize = Math.round(size * 0.42);
    const subFontSize = Math.round(subSize * 0.45);
    $container.css({
        '--hl-btn-size': size + 'px',
        '--hl-btn-color': state.settings.floatingBtnColor || '#333333',
        '--hl-btn-icon-color': state.settings.floatingBtnIconColor || '#ffffff',
        '--hl-sub-size': subSize + 'px',
        '--hl-btn-font-size': fontSize + 'px',
        '--hl-sub-font-size': subFontSize + 'px',
    });

    const positions = {
        'bottom-right': { bottom: '80px', right: '20px', top: 'auto', left: 'auto' },
        'bottom-left': { bottom: '80px', left: '20px', top: 'auto', right: 'auto' },
        'top-right': { top: '80px', right: '20px', bottom: 'auto', left: 'auto' },
        'top-left': { top: '80px', left: '20px', bottom: 'auto', right: 'auto' }
    };

    const pos = positions[state.settings.buttonPosition] || positions['bottom-right'];
    $container.css(pos);

    // 버튼 위치에 따라 메뉴 방향 결정
    const buttonPos = state.settings.buttonPosition || 'bottom-right';
    if (buttonPos.startsWith('top-')) {
        $container.addClass('menu-below');
        $container.removeClass('menu-above');
    } else {
        $container.addClass('menu-above');
        $container.removeClass('menu-below');
    }
}

export function toggleHighlightMode() {
    // 항상 활성화 모드일 때는 비활성화 방지
    if (state.settings.alwaysHighlightMode && state.isHighlightMode) {
        toastr.warning('형광펜 모드 항상 활성화가 설정되어 있습니다');
        return;
    }

    state.isHighlightMode = !state.isHighlightMode;
    $('#hl-floating-highlight-mode-btn').toggleClass('active', state.isHighlightMode);

    // 요술봉 메뉴 상태 업데이트
    const $status = $('#highlighter_mode_status');
    if ($status.length) {
        $status.text(state.isHighlightMode ? '(켜짐)' : '(꺼짐)');
    }

    if (state.isHighlightMode) {
        enableHighlightMode();
        toastr.info('형광펜 모드 활성화');
    } else {
        disableHighlightMode();
        toastr.info('형광펜 모드 비활성화');
    }
}
