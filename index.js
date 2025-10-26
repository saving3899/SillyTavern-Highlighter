import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    chat,
    characters,
    this_chid
} from '../../../../script.js';

import {
    getContext,
    extension_settings
} from '../../../extensions.js';

import {
    executeSlashCommandsWithOptions
} from '../../../../scripts/slash-commands.js';

const extensionName = 'SillyTavern-Highlighter';
const EXT_PATHS = [
    `scripts/extensions/third-party/${extensionName}`,
    `../../../data/default-user/extensions/${extensionName}`, // 상대 경로 고려
];

async function getExtensionFolderPath() {
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

// 요술봉 메뉴에 버튼 추가
async function addToWandMenu() {
    try {
        const extensionFolderPath = await getExtensionFolderPath();
        const buttonHtml = await $.get(`${extensionFolderPath}/button.html`);

        const extensionsMenu = $("#extensionsMenu");
        if (extensionsMenu.length > 0) {
            extensionsMenu.append(buttonHtml);

            // 형광펜 모드 버튼 클릭 이벤트
            $("#highlighter_wand_button").on("click", function() {
                toggleHighlightMode();
            });

            // 독서노트 패널 버튼 클릭 이벤트
            $("#highlighter_panel_button").on("click", function() {
                openPanel();
            });
        } else {
            setTimeout(addToWandMenu, 1000);
        }
    } catch (error) {
        // 버튼 로드 실패시 재시도
        setTimeout(addToWandMenu, 1000);
    }
}

// 색상 커스터마이저 함수들
function getColors() {
    return settings.customColors || DEFAULT_COLORS;
}

function initColorCustomizer() {
    const $container = $('#hl-color-customizer');
    $container.empty();

    const colors = getColors();

    colors.forEach((colorConfig, index) => {
        const previewBg = hexToRgba(colorConfig.bg, colorConfig.opacity);
        const textColor = colorConfig.useDefaultTextColor ? 'inherit' : colorConfig.textColor;

        const item = `
            <div class="hl-color-item" data-index="${index}">
                <div class="hl-color-preview" style="background-color: ${previewBg};">
                    <div class="hl-color-preview-text" style="color: ${textColor};">가</div>
                </div>
                <div class="hl-color-controls">
                    <div class="hl-color-control-row">
                        <label>배경색:</label>
                        <input type="color" class="hl-bg-color" value="${colorConfig.bg}">
                    </div>
                    <div class="hl-color-control-row">
                        <label>불투명도:</label>
                        <input type="range" class="hl-opacity" min="0" max="100" value="${Math.round(colorConfig.opacity * 100)}">
                        <input type="number" class="hl-opacity-input" min="0" max="100" value="${Math.round(colorConfig.opacity * 100)}">
                        <span>%</span>
                    </div>
                    <div class="hl-color-control-row">
                        <label>글자색:</label>
                        <input type="color" class="hl-text-color" value="${colorConfig.textColor}" ${colorConfig.useDefaultTextColor ? 'disabled' : ''}>
                        <label class="hl-use-default-label">
                            <input type="checkbox" class="hl-use-default" ${colorConfig.useDefaultTextColor ? 'checked' : ''}>
                            <span class="hl-checkbox-text">원래 색상 사용</span>
                        </label>
                    </div>
                </div>
            </div>
        `;

        $container.append(item);
    });

    bindColorCustomizerEvents();

}

function bindColorCustomizerEvents() {
    // 기존 이벤트 제거 (중복 방지)
    $('.hl-bg-color').off('input');
    $('.hl-opacity').off('input');
    $('.hl-opacity-input').off('input');
    $('.hl-text-color').off('input');
    $('.hl-use-default').off('change');

    $('.hl-bg-color').on('input', function() {
        const $item = $(this).closest('.hl-color-item');
        const index = $item.data('index');
        const oldColor = settings.customColors[index].bg;
        const newColor = $(this).val();

        // 배경색 업데이트
        settings.customColors[index].bg = newColor;

        // 기존 하이라이트들의 색상도 함께 업데이트
        updateAllHighlightColors(oldColor, newColor);

        updateColorPreview($item);
        updateDynamicColorStyles();
        saveSettingsDebounced();
    });

    $('.hl-opacity').on('input', function() {
        const $item = $(this).closest('.hl-color-item');
        const index = $item.data('index');
        const value = parseInt($(this).val());
        settings.customColors[index].opacity = value / 100;
        $item.find('.hl-opacity-input').val(value);
        updateColorPreview($item);
        updateDynamicColorStyles();

        // 채팅 내 해당 색상의 모든 하이라이트 업데이트
        const color = settings.customColors[index].bg;
        $(`.text-highlight[data-color="${color}"]`).each(function() {
            const bgColor = getBackgroundColorFromHex(color);
            $(this).css('background-color', bgColor);
        });

        saveSettingsDebounced();
    });

    $('.hl-opacity-input').on('input', function() {
        const $item = $(this).closest('.hl-color-item');
        const index = $item.data('index');
        let value = parseInt($(this).val());

        // 범위 체크
        if (value < 0) value = 0;
        if (value > 100) value = 100;
        if (isNaN(value)) value = 0;

        settings.customColors[index].opacity = value / 100;
        const $range = $item.find('.hl-opacity');
        $range.val(value);
        $(this).val(value);
        updateColorPreview($item);
        updateDynamicColorStyles();

        // 채팅 내 해당 색상의 모든 하이라이트 업데이트
        const color = settings.customColors[index].bg;
        $(`.text-highlight[data-color="${color}"]`).each(function() {
            const bgColor = getBackgroundColorFromHex(color);
            $(this).css('background-color', bgColor);
        });

        saveSettingsDebounced();
    });

    $('.hl-text-color').on('input', function() {
        const $item = $(this).closest('.hl-color-item');
        const index = $item.data('index');
        settings.customColors[index].textColor = $(this).val();
        updateColorPreview($item);
        updateDynamicColorStyles();
        saveSettingsDebounced();
    });

    $('.hl-use-default').on('change', function() {
        const $item = $(this).closest('.hl-color-item');
        const index = $item.data('index');
        const checked = $(this).is(':checked');
        settings.customColors[index].useDefaultTextColor = checked;
        $item.find('.hl-text-color').prop('disabled', checked);
        updateColorPreview($item);
        updateDynamicColorStyles();
        saveSettingsDebounced();
    });
}

function updateColorPreview($item) {
    const index = $item.data('index');
    const colorConfig = settings.customColors[index];
    const previewBg = hexToRgba(colorConfig.bg, colorConfig.opacity);
    const textColor = colorConfig.useDefaultTextColor ? 'inherit' : colorConfig.textColor;

    $item.find('.hl-color-preview').css('background-color', previewBg);
    $item.find('.hl-color-preview-text').css('color', textColor);
}

function hexToRgba(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function updateDynamicColorStyles() {
    // 동적으로 스타일 업데이트
    $('#hl-dynamic-styles').remove();

    const colors = getColors();
    let styleContent = '';

    colors.forEach((colorConfig) => {
        const rgba = hexToRgba(colorConfig.bg, colorConfig.opacity);
        styleContent += `.text-highlight[data-color="${colorConfig.bg}"] { --hl-bg-color: ${rgba} !important; }\n`;

        if (!colorConfig.useDefaultTextColor) {
            styleContent += `.text-highlight[data-color="${colorConfig.bg}"] { color: ${colorConfig.textColor} !important; }\n`;
        }
    });

    $('<style id="hl-dynamic-styles">' + styleContent + '</style>').appendTo('head');
}

function updateAllHighlightColors(oldColor, newColor) {
    // 모든 캐릭터의 모든 채팅의 모든 하이라이트 색상 업데이트
    for (const charId in settings.highlights) {
        for (const chatFile in settings.highlights[charId]) {
            const chatData = settings.highlights[charId][chatFile];
            if (chatData && chatData.highlights) {
                chatData.highlights.forEach(hl => {
                    if (hl.color === oldColor) {
                        hl.color = newColor;
                    }
                });
            }
        }
    }

    // DOM의 하이라이트도 업데이트 (제거하지 않고 직접 수정)
    $(`.text-highlight[data-color="${oldColor}"]`).each(function() {
        $(this).attr('data-color', newColor);
        const bgColor = getBackgroundColorFromHex(newColor);
        $(this).css('background-color', bgColor);
    });

    // 패널이 열려있으면 새로고침
    if ($('#highlighter-panel').hasClass('visible')) {
        renderView();
    }
}

function resetColors() {
    if (!confirm('색상 설정을 초기화하시겠습니까?')) return;

    // 기존 색상 -> 인덱스 매핑
    const oldColors = settings.customColors.map(c => c.bg);

    settings.customColors = JSON.parse(JSON.stringify(DEFAULT_COLORS));
    initColorCustomizer();
    updateDynamicColorStyles();

    // 각 하이라이트의 색상을 새 팔레트로 업데이트
    for (const charId in settings.highlights) {
        for (const chatFile in settings.highlights[charId]) {
            const chatData = settings.highlights[charId][chatFile];
            if (chatData && chatData.highlights) {
                chatData.highlights.forEach(hl => {
                    const oldIndex = oldColors.indexOf(hl.color);
                    if (oldIndex !== -1) {
                        hl.color = settings.customColors[oldIndex].bg;
                    } else {
                        // 색상을 찾지 못한 경우 첫 번째 색상으로 폴백
                        hl.color = settings.customColors[0].bg;
                    }
                });
            }
        }
    }

    // 채팅 내 모든 하이라이트 제거하고 다시 그리기
    $('.text-highlight').each(function() {
        $(this).contents().unwrap();
    });

    renderView(); // 패널에 바뀐 색상 적용
    restoreHighlightsInChat(); // 새 색상으로 다시 그리기
    saveSettingsDebounced();
    toastr.success('색상 설정이 초기화되었습니다');
}

function exportColors() {
    const data = {
        version: '1.0',
        colors: settings.customColors
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `highlighter_colors_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toastr.success('색상 설정이 백업되었습니다');
}

function importColors(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const data = JSON.parse(event.target.result);

            if (!data.colors || !Array.isArray(data.colors) || data.colors.length !== 5) {
                throw new Error('잘못된 파일 형식입니다');
            }

            // 유효성 검사
            data.colors.forEach(color => {
                if (!color.bg || !color.hasOwnProperty('opacity') || !color.textColor || !color.hasOwnProperty('useDefaultTextColor')) {
                    throw new Error('잘못된 색상 데이터입니다');
                }
            });

            // 기존 색상 -> 인덱스 매핑
            const oldColors = settings.customColors.map(c => c.bg);

            settings.customColors = data.colors;
            initColorCustomizer();
            updateDynamicColorStyles();

            // 각 하이라이트의 색상을 새 팔레트로 업데이트
            for (const charId in settings.highlights) {
                for (const chatFile in settings.highlights[charId]) {
                    const chatData = settings.highlights[charId][chatFile];
                    if (chatData && chatData.highlights) {
                        chatData.highlights.forEach(hl => {
                            const oldIndex = oldColors.indexOf(hl.color);
                            if (oldIndex !== -1) {
                                hl.color = settings.customColors[oldIndex].bg;
                            } else {
                                // 색상을 찾지 못한 경우 첫 번째 색상으로 폴백
                                hl.color = settings.customColors[0].bg;
                            }
                        });
                    }
                }
            }

            // 채팅 내 모든 하이라이트 제거하고 다시 그리기
            $('.text-highlight').each(function() {
                $(this).contents().unwrap();
            });

            renderView(); // 패널에 바뀐 색상 적용
            restoreHighlightsInChat(); // 새 색상으로 다시 그리기
            saveSettingsDebounced();
            toastr.success('색상 설정을 불러왔습니다');
        } catch (error) {
            toastr.error('색상 설정 불러오기 실패: ' + error.message);
        }
    };
    reader.readAsText(file);

    // 파일 입력 초기화
    $(e.target).val('');
}


const VIEW_LEVELS = {
    CHARACTER_LIST: 'character_list',
    CHAT_LIST: 'chat_list',
    HIGHLIGHT_LIST: 'highlight_list'
};

// 밝은 파스텔 톤 기본 색상
const DEFAULT_COLORS = [
    { bg: '#FFE4B5', opacity: 0.8, textColor: '#222', useDefaultTextColor: false },
    { bg: '#D4F1D4', opacity: 0.8, textColor: '#222', useDefaultTextColor: false },
    { bg: '#E6D5F0', opacity: 0.8, textColor: '#222', useDefaultTextColor: false },
    { bg: '#C7EBFF', opacity: 0.8, textColor: '#222', useDefaultTextColor: false },
    { bg: '#FFD4E5', opacity: 0.8, textColor: '#222', useDefaultTextColor: false }
];

const GITHUB_REPO = 'saving3899/SillyTavern-Highlighter'; // GitHub 저장소
const UPDATE_CHECK_CACHE_KEY = 'highlighter_update_check';
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24시간 (밀리초)

// ⭐ 로컬 manifest.json에서 버전을 가져올 것임 (초기화 시 로드)
let EXTENSION_VERSION = '1.0.0'; // 기본값 (manifest.json 로드 전)

const DEFAULT_SETTINGS = {
    version: '1.0.0', // 데이터 버전 관리 (manifest에서 자동 업데이트됨)
    enabled: true,
    deleteMode: 'keep',
    darkMode: false,
    buttonPosition: 'bottom-right',
    showFloatingBtn: true, // 플로팅 버튼 표시 여부
    alwaysHighlightMode: false, // 형광펜 모드 항상 활성화
    panelPosition: null, // { top, left } 저장
    highlights: {},
    customColors: null, // 커스텀 색상 배열
    sortOptions: {
        characters: 'modified', // 'modified', 'name'
        chats: 'modified', // 'modified', 'name'
        highlights: 'created' // 'created', 'message'
    }
};

let settings;
let currentView = VIEW_LEVELS.CHARACTER_LIST;
let selectedCharacter = null;
let selectedChat = null;
let isHighlightMode = false;
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let previousChatFile = null; // 채팅 제목 변경 감지용
let previousCharId = null; // 캐릭터 변경 감지용
let previousChatLength = null; // 채팅 메시지 개수 (같은 채팅인지 확인용)

// ====================================
// 데이터 안정성 및 마이그레이션
// ====================================

// 데이터 검증 및 복구 (안전하게, 기존 데이터 보존)
function validateAndRepairSettings(data) {
    try {
        // 필수 필드 확인 및 기본값 설정
        if (!data || typeof data !== 'object') {
            console.warn('[SillyTavern-Highlighter] Invalid settings, using defaults');
            return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        }

        // 필수 필드 존재 확인 (없으면 추가, 기존 값은 유지)
        if (!data.highlights) data.highlights = {};
        if (!data.deleteMode) data.deleteMode = 'keep';
        if (data.darkMode === undefined) data.darkMode = false;
        if (!data.buttonPosition) data.buttonPosition = 'bottom-right';
        if (data.showFloatingBtn === undefined) data.showFloatingBtn = true;
        if (data.alwaysHighlightMode === undefined) data.alwaysHighlightMode = false;
        if (!data.customColors) data.customColors = JSON.parse(JSON.stringify(DEFAULT_COLORS));
        if (!data.sortOptions) {
            data.sortOptions = {
                characters: 'modified',
                chats: 'modified',
                highlights: 'created'
            };
        }

        // highlights 데이터 경고만 출력 (삭제하지 않음 - 데이터 보존)
        for (const charId in data.highlights) {
            if (!data.highlights[charId] || typeof data.highlights[charId] !== 'object') {
                console.warn(`[SillyTavern-Highlighter] Invalid data for character ${charId}, but keeping it`);
                continue;
            }

            for (const chatFile in data.highlights[charId]) {
                const chatData = data.highlights[charId][chatFile];
                if (!chatData) {
                    console.warn(`[SillyTavern-Highlighter] Invalid chat data for ${charId}/${chatFile}, but keeping it`);
                    continue;
                }

                // highlights 배열 확인
                if (!Array.isArray(chatData.highlights)) {
                    console.warn(`[SillyTavern-Highlighter] highlights is not an array for ${charId}/${chatFile}, converting`);
                    chatData.highlights = [];
                }
            }
        }

        return data;
    } catch (error) {
        console.error('[SillyTavern-Highlighter] Error validating settings:', error);
        // 에러 발생 시에도 원본 데이터 반환 (기본값으로 교체하지 않음)
        return data || JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
}

// 데이터 마이그레이션
function migrateSettings(data) {
    try {
        const currentVersion = data.version || null;

        // 버전이 없거나 1.0.0 미만인 경우 마이그레이션
        if (!currentVersion || currentVersion !== EXTENSION_VERSION) {
            console.log(`[SillyTavern-Highlighter] Migrating from ${currentVersion || 'pre-1.0.0'} to ${EXTENSION_VERSION}`);

            // textOffset 필드 추가 (없으면 0으로)
            for (const charId in data.highlights) {
                for (const chatFile in data.highlights[charId]) {
                    const chatData = data.highlights[charId][chatFile];
                    if (chatData && Array.isArray(chatData.highlights)) {
                        chatData.highlights.forEach(hl => {
                            if (hl && hl.textOffset === undefined) {
                                hl.textOffset = 0; // 기본값
                            }
                        });
                    }
                }
            }

            console.log('[SillyTavern-Highlighter] Migration completed');
        } else {
            console.log(`[SillyTavern-Highlighter] Already at version ${EXTENSION_VERSION}, no migration needed`);
        }

        // 버전 업데이트
        data.version = EXTENSION_VERSION;

        return data;
    } catch (error) {
        console.error('[SillyTavern-Highlighter] Migration error:', error);
        // 에러 발생해도 원본 데이터 반환
        return data;
    }
}


function createHighlighterUI() {
    const html = `
        <div id="highlighter-floating-container">
            <button id="highlighter-toggle-btn" title="메뉴 열기">
                <i class="fa-solid fa-bars"></i>
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
                    <button class="highlighter-btn hl-text-btn" id="hl-current-chat-btn" title="현재 채팅으로">
                        현재 채팅
                    </button>
                    <button class="highlighter-btn" id="hl-theme-toggle-btn" title="다크모드">
                        <i class="fa-solid fa-moon"></i>
                    </button>
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
            </div>

            <div class="highlighter-breadcrumb" id="highlighter-breadcrumb"></div>
            <div class="highlighter-content" id="highlighter-content"></div>
        </div>

        <input type="file" id="hl-import-file-input" accept=".json" style="display: none;">
    `;

    $('body').append(html);
    bindUIEvents();
    bindHighlightClickEvents(); // 하이라이트 클릭 이벤트 위임 설정
    applyDarkMode();
    applyButtonPosition();
}

function bindUIEvents() {
    $('#highlighter-toggle-btn').on('click', toggleFloatingMenu);
    $('#hl-floating-panel-btn').on('click', openPanel);
    $('#hl-floating-highlight-mode-btn').on('click', toggleHighlightMode);
    $('#hl-close-btn').on('click', closePanel);
    $('#hl-current-chat-btn').on('click', navigateToCurrentChat);
    $('#hl-theme-toggle-btn').on('click', toggleDarkMode);
    $('#hl-header-more-btn').on('click', showHeaderMoreMenu);

    $('#hl-import-file-input').on('change', function (e) {
        const file = e.target.files[0];
        if (file) importHighlights(file);
    });

    $('.highlighter-tab').on('click', function () {
        $('.highlighter-tab').removeClass('active');
        $(this).addClass('active');
        renderView();
    });

    if (window.innerWidth > 768) {
        bindDragFunctionality();
    }

    // 외부 클릭 시 플로팅 메뉴 닫기
    $(document).on('click', function(e) {
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
            showHighlightContextMenu(hlId, e.clientX, e.clientY);
        }
    });

    console.log('[SillyTavern-Highlighter] Click events bound with delegation');
}

function bindDragFunctionality() {
    const $panel = $('#highlighter-panel');
    const $header = $('.highlighter-header');

    $header.on('mousedown', function (e) {
        if ($(e.target).closest('.highlighter-btn').length) return;

        isDragging = true;
        $panel.addClass('dragging');

        const rect = $panel[0].getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;

        e.preventDefault();
    });

    $(document).on('mousemove', function (e) {
        if (!isDragging) return;

        requestAnimationFrame(() => {
            let newLeft = e.clientX - dragOffsetX;
            let newTop = e.clientY - dragOffsetY;

            const maxX = window.innerWidth - $panel.width();
            const maxY = window.innerHeight - $panel.height();

            newLeft = Math.max(0, Math.min(newLeft, maxX));
            newTop = Math.max(0, Math.min(newTop, maxY));

            $panel.css({
                left: newLeft + 'px',
                top: newTop + 'px',
                right: 'auto',
                bottom: 'auto',
                transform: 'none'
            });
        });
    });

    $(document).on('mouseup', function () {
        if (isDragging) {
            isDragging = false;
            $panel.removeClass('dragging');

            // 패널 위치 저장
            const rect = $panel[0].getBoundingClientRect();
            settings.panelPosition = {
                top: rect.top,
                left: rect.left
            };
            saveSettingsDebounced();
        }
    });
}

function toggleFloatingMenu() {
    const $menu = $('#highlighter-floating-menu');
    const isVisible = $menu.is(':visible');

    if (isVisible) {
        $menu.slideUp(200);
    } else {
        $menu.slideDown(200);
    }
}

function openPanel() {
    const $panel = $('#highlighter-panel');

    // 플로팅 메뉴 닫기
    $('#highlighter-floating-menu').slideUp(200);

    // 패널 열기
    $panel.addClass('visible');

    // 저장된 위치가 있으면 복원 (모바일 제외)
    if (settings.panelPosition && window.innerWidth > 768) {
        $panel.css({
            top: settings.panelPosition.top + 'px',
            left: settings.panelPosition.left + 'px',
            right: 'auto',
            bottom: 'auto',
            transform: 'none'
        });
    }

    // 모바일에서 body 스크롤 방지
    if (window.innerWidth <= 768) {
        $('body').css('overflow', 'hidden');
    }

    renderView();
}

function closePanel() {
    $('#highlighter-panel').removeClass('visible');

    // 모바일에서 body 스크롤 복원
    if (window.innerWidth <= 768) {
        $('body').css('overflow', '');
    }
}

function toggleDarkMode() {
    settings.darkMode = !settings.darkMode;
    applyDarkMode();
    saveSettingsDebounced();
}

function applyDarkMode() {
    const $panel = $('#highlighter-panel');
    const $icon = $('#hl-theme-toggle-btn i');

    if (settings.darkMode) {
        $panel.addClass('dark-mode');
        $icon.removeClass('fa-moon').addClass('fa-sun');
    } else {
        $panel.removeClass('dark-mode');
        $icon.removeClass('fa-sun').addClass('fa-moon');
    }
}

function getDarkModeClass() {
    return settings.darkMode ? 'dark-mode' : '';
}

function applyButtonPosition() {
    const $container = $('#highlighter-floating-container');

    // 플로팅 버튼 표시/숨김
    if (settings.showFloatingBtn === false) {
        $container.addClass('hidden');
        return;
    } else {
        $container.removeClass('hidden');
    }

    const positions = {
        'bottom-right': { bottom: '80px', right: '20px', top: 'auto', left: 'auto' },
        'bottom-left': { bottom: '80px', left: '20px', top: 'auto', right: 'auto' },
        'top-right': { top: '80px', right: '20px', bottom: 'auto', left: 'auto' },
        'top-left': { top: '80px', left: '20px', bottom: 'auto', right: 'auto' }
    };

    const pos = positions[settings.buttonPosition] || positions['bottom-right'];
    $container.css(pos);

    // 버튼 위치에 따라 메뉴 방향 결정
    const buttonPos = settings.buttonPosition || 'bottom-right';
    if (buttonPos.startsWith('top-')) {
        $container.addClass('menu-below');
        $container.removeClass('menu-above');
    } else {
        $container.addClass('menu-above');
        $container.removeClass('menu-below');
    }
}

function toggleHighlightMode() {
    // 항상 활성화 모드일 때는 비활성화 방지
    if (settings.alwaysHighlightMode && isHighlightMode) {
        toastr.warning('형광펜 모드 항상 활성화가 설정되어 있습니다');
        return;
    }

    isHighlightMode = !isHighlightMode;
    $('#hl-floating-highlight-mode-btn').toggleClass('active', isHighlightMode);

    // 요술봉 메뉴 상태 업데이트
    const $status = $('#highlighter_mode_status');
    if ($status.length) {
        $status.text(isHighlightMode ? '(켜짐)' : '(꺼짐)');
    }

    if (isHighlightMode) {
        enableHighlightMode();
        toastr.info('형광펜 모드 활성화');
    } else {
        disableHighlightMode();
        toastr.info('형광펜 모드 비활성화');
    }
}

function navigateToCurrentChat() {
    const chatFile = getCurrentChatFile();
    const charId = this_chid;

    if (!chatFile || !charId) {
        toastr.warning('채팅이 열려있지 않습니다');
        return;
    }

    navigateToHighlightList(charId, chatFile);
}

function navigateToCharacterList() {
    currentView = VIEW_LEVELS.CHARACTER_LIST;
    selectedCharacter = null;
    selectedChat = null;
    renderView();
}

function navigateToChatList(characterId) {
    currentView = VIEW_LEVELS.CHAT_LIST;
    selectedCharacter = characterId;
    selectedChat = null;
    renderView();
}

function navigateToHighlightList(characterId, chatFile) {
    currentView = VIEW_LEVELS.HIGHLIGHT_LIST;
    selectedCharacter = characterId;
    selectedChat = chatFile;
    renderView();
}

function updateBreadcrumb() {
    const $breadcrumb = $('#highlighter-breadcrumb');
    $breadcrumb.empty();

    let html = '';

    // 정렬 옵션 초기화
    if (!settings.sortOptions) {
        settings.sortOptions = {
            characters: 'modified',
            chats: 'modified',
            highlights: 'created'
        };
    }

    // 뒤로가기 버튼 방식으로 변경
    if (selectedChat) {
        // 하이라이트 목록 → 채팅 목록
        html = '<button class="hl-back-btn" data-action="back-to-chat"><i class="fa-solid fa-arrow-left"></i> 채팅 목록</button>';
        // 채팅 이름만 표시 (캐릭터 이름 제거)
        html += ` <span class="breadcrumb-current">${selectedChat}</span>`;

        // 정렬 드롭다운 추가
        html += `
            <select class="hl-sort-select" id="hl-sort-highlights">
                <option value="created" ${settings.sortOptions.highlights === 'created' ? 'selected' : ''}>최근 생성순</option>
                <option value="message" ${settings.sortOptions.highlights === 'message' ? 'selected' : ''}>채팅순</option>
            </select>
        `;

        // More 메뉴 버튼 추가 (하이라이트 목록일 때만)
        html += `
            <button class="hl-more-btn" id="hl-breadcrumb-more-btn" title="더보기">
                <i class="fa-solid fa-ellipsis-vertical"></i>
            </button>
        `;
    } else if (selectedCharacter) {
        // 채팅 목록 → 캐릭터 목록
        html = '<button class="hl-back-btn" data-action="back-to-home"><i class="fa-solid fa-arrow-left"></i> 모든 캐릭터</button>';
        const charName = getCharacterName(selectedCharacter);
        html += ` <span class="breadcrumb-current">${charName}</span>`;

        // 정렬 드롭다운 추가
        html += `
            <select class="hl-sort-select" id="hl-sort-chats">
                <option value="modified" ${settings.sortOptions.chats === 'modified' ? 'selected' : ''}>최근 수정순</option>
                <option value="name" ${settings.sortOptions.chats === 'name' ? 'selected' : ''}>이름순</option>
            </select>
        `;

        // More 메뉴 버튼 추가 (채팅 목록일 때만)
        html += `
            <button class="hl-more-btn" id="hl-breadcrumb-more-btn" title="더보기">
                <i class="fa-solid fa-ellipsis-vertical"></i>
            </button>
        `;
    } else {
        // 캐릭터 목록 (최상위)
        html = '<span class="breadcrumb-current">모든 캐릭터</span>';

        // 정렬 드롭다운 추가
        html += `
            <select class="hl-sort-select" id="hl-sort-characters">
                <option value="modified" ${settings.sortOptions.characters === 'modified' ? 'selected' : ''}>최근 수정순</option>
                <option value="name" ${settings.sortOptions.characters === 'name' ? 'selected' : ''}>이름순</option>
            </select>
        `;
    }

    $breadcrumb.html(html);

    // 기존 이벤트 제거 후 재바인딩 (중복 방지)
    $('[data-action="back-to-home"]').off('click').on('click', navigateToCharacterList);
    $('[data-action="back-to-chat"]').off('click').on('click', () => navigateToChatList(selectedCharacter));
    $('#hl-breadcrumb-more-btn').off('click').on('click', showBreadcrumbMoreMenu);

    // 정렬 옵션 변경 이벤트
    $('#hl-sort-highlights').off('change').on('change', function() {
        settings.sortOptions.highlights = $(this).val();
        saveSettingsDebounced();
        renderView();
    });

    $('#hl-sort-chats').off('change').on('change', function() {
        settings.sortOptions.chats = $(this).val();
        saveSettingsDebounced();
        renderView();
    });

    $('#hl-sort-characters').off('change').on('change', function() {
        settings.sortOptions.characters = $(this).val();
        saveSettingsDebounced();
        renderView();
    });
}

function renderView() {
    updateBreadcrumb();

    const $content = $('#highlighter-content');
    $content.empty();

    const activeTab = $('.highlighter-tab.active').data('tab');

    switch (currentView) {
        case VIEW_LEVELS.CHARACTER_LIST:
            renderCharacterList($content);
            resetTabCounts(); // 탭 개수 초기화
            break;
        case VIEW_LEVELS.CHAT_LIST:
            renderChatList($content, selectedCharacter);
            resetTabCounts(); // 탭 개수 초기화
            break;
        case VIEW_LEVELS.HIGHLIGHT_LIST:
            renderHighlightList($content, selectedCharacter, selectedChat, activeTab);
            updateTabCounts(); // 하이라이트 목록에서만 탭 개수 업데이트
            break;
    }
}

function updateTabCounts() {
    // 하이라이트 목록 뷰에서만 작동
    if (currentView !== VIEW_LEVELS.HIGHLIGHT_LIST || !selectedCharacter || !selectedChat) return;

    const highlights = settings.highlights[selectedCharacter]?.[selectedChat]?.highlights || [];

    // 전체 개수
    const totalCount = highlights.length;

    // 메모가 있는 하이라이트 개수
    const noteCount = highlights.filter(h => h.note && h.note.trim()).length;

    // 탭 텍스트 업데이트
    $('[data-tab="all"]').html(`전체 (${totalCount})`);
    $('[data-tab="highlights"]').html(`형광펜 (${totalCount})`);
    $('[data-tab="notes"]').html(`메모 (${noteCount})`);
}

function resetTabCounts() {
    // 탭 개수 표시 제거
    $('[data-tab="all"]').html('전체');
    $('[data-tab="highlights"]').html('형광펜');
    $('[data-tab="notes"]').html('메모');
}

function renderCharacterList($container) {
    let charIds = Object.keys(settings.highlights).filter(charId => {
        const chats = settings.highlights[charId];
        return Object.keys(chats).some(chatFile => chats[chatFile].highlights.length > 0);
    });

    if (charIds.length === 0) {
        $container.html(`
            <div class="hl-empty">
                <div class="hl-empty-icon"><i class="fa-solid fa-book-open"></i></div>
                <div class="hl-empty-text">아직 저장된 하이라이트가 없습니다</div>
            </div>
        `);
        return;
    }

    // 정렬
    const sortOption = settings.sortOptions?.characters || 'modified';
    if (sortOption === 'name') {
        // 이름순 (가나다)
        charIds.sort((a, b) => {
            const nameA = getCharacterName(a);
            const nameB = getCharacterName(b);
            return nameA.localeCompare(nameB, 'ko-KR');
        });
    } else {
        // 최근 수정순
        charIds.sort((a, b) => {
            const chatsA = settings.highlights[a];
            const chatsB = settings.highlights[b];
            const lastModifiedA = Math.max(...Object.values(chatsA).map(c => c.lastModified || 0));
            const lastModifiedB = Math.max(...Object.values(chatsB).map(c => c.lastModified || 0));
            return lastModifiedB - lastModifiedA; // 최신이 위로
        });
    }

    charIds.forEach(charId => {
        const charData = characters[charId];
        const charName = charData?.name || 'Unknown';
        const totalHighlights = getTotalHighlightsForCharacter(charId);
        const avatar = charData?.avatar ?
            `/thumbnail?type=avatar&file=${charData.avatar}` :
            '/img/five.png';

        const item = `
            <div class="hl-list-item" data-char-id="${charId}">
                <img src="${avatar}" class="hl-icon" onerror="this.src='/img/five.png'">
                <div class="hl-info">
                    <div class="hl-name">${charName}</div>
                    <div class="hl-count">${totalHighlights}개</div>
                </div>
                <i class="fa-solid fa-chevron-right hl-chevron"></i>
            </div>
        `;
        $container.append(item);
    });

    // 클릭 이벤트 바인딩 (중복 방지)
    $('.hl-list-item').off('click').on('click', function () {
        navigateToChatList($(this).data('charId'));
    });
}

function renderChatList($container, characterId) {
    const chats = settings.highlights[characterId];
    let chatFiles = Object.keys(chats).filter(chatFile => chats[chatFile].highlights.length > 0);

    if (chatFiles.length === 0) {
        $container.html(`
            <div class="hl-empty">
                <div class="hl-empty-icon"><i class="fa-solid fa-message"></i></div>
                <div class="hl-empty-text">하이라이트가 없습니다</div>
            </div>
        `);
        return;
    }

    // 정렬
    const sortOption = settings.sortOptions?.chats || 'modified';
    if (sortOption === 'name') {
        // 이름순 (가나다)
        chatFiles.sort((a, b) => a.localeCompare(b, 'ko-KR'));
    } else {
        // 최근 수정순
        chatFiles.sort((a, b) => {
            const lastModifiedA = chats[a].lastModified || 0;
            const lastModifiedB = chats[b].lastModified || 0;
            return lastModifiedB - lastModifiedA; // 최신이 위로
        });
    }

    chatFiles.forEach(chatFile => {
        const chatData = chats[chatFile];
        const count = chatData.highlights.length;
        const last = chatData.highlights[chatData.highlights.length - 1];
        const preview = last ? last.text.substring(0, 50) + (last.text.length > 50 ? '...' : '') : '';

        const item = `
            <div class="hl-list-item" data-chat-file="${chatFile}">
                <div class="hl-chat-icon">
                    <i class="fa-solid fa-message"></i>
                </div>
                <div class="hl-info">
                    <div class="hl-name">${chatFile} (${count})</div>
                    <div class="hl-preview">${preview}</div>
                </div>
                <i class="fa-solid fa-chevron-right hl-chevron"></i>
            </div>
        `;
        $container.append(item);
    });

    // 클릭 이벤트 바인딩 (중복 방지)
    $('.hl-list-item').off('click').on('click', function () {
        navigateToHighlightList(selectedCharacter, $(this).data('chatFile'));
    });
}

function renderHighlightList($container, characterId, chatFile, activeTab) {
    const highlights = settings.highlights[characterId]?.[chatFile]?.highlights || [];

    let filtered = activeTab === 'notes' ?
        highlights.filter(h => h.note && h.note.trim()) :
        highlights;

    if (filtered.length === 0) {
        const msg = activeTab === 'notes' ? '메모가 없습니다' : '하이라이트가 없습니다';
        $container.html(`
            <div class="hl-empty">
                <div class="hl-empty-icon"><i class="fa-solid fa-highlighter"></i></div>
                <div class="hl-empty-text">${msg}</div>
            </div>
        `);
        return;
    }

    // 정렬
    const sortOption = settings.sortOptions?.highlights || 'created';
    if (sortOption === 'message') {
        // 채팅순 (위→아래)
        filtered.sort((a, b) => {
            // 메시지 ID로 먼저 정렬
            if (a.mesId !== b.mesId) {
                return a.mesId - b.mesId;
            }
            // 같은 메시지 내에서는 텍스트 위치 순서대로
            if (a.textOffset !== undefined && b.textOffset !== undefined) {
                return a.textOffset - b.textOffset;
            }
            // textOffset이 없으면 timestamp로 폴백 (하위 호환성)
            return (a.timestamp || 0) - (b.timestamp || 0);
        });
    } else {
        // 최근 생성순 (최신이 위로)
        filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    filtered.forEach(hl => {
        const date = new Date(hl.timestamp).toLocaleDateString('ko-KR');
        // ⭐ 수정: 저장된 라벨이 있으면 사용, 없으면 현재 chat으로부터 가져오기 (하위 호환성)
        const label = hl.label || getMessageLabel(hl.mesId);

        const item = `
            <div class="hl-highlight-item" style="--highlight-color: ${hl.color}" data-mes-id="${hl.mesId}" data-hl-id="${hl.id}">
                <div class="hl-content">
                    <div class="hl-text">${hl.text}</div>
                    ${hl.note ? `<div class="hl-note"><i class="fa-solid fa-note-sticky"></i> ${hl.note}</div>` : ''}
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
        `;
        $container.append(item);
    });

    // 아이템 클릭 시 이동 (more 버튼 제외) - 중복 방지
    $('.hl-highlight-item').off('click').on('click', function(e) {
        // more 버튼 클릭 시에는 무시
        if ($(e.target).closest('.hl-more-btn').length > 0) {
            return;
        }

        const mesId = $(this).data('mesId');
        const hlId = $(this).data('hlId');
        jumpToMessage(mesId, hlId);
    });

    // more 버튼 클릭 시 메뉴 표시 - 중복 방지
    $('.hl-item-more-btn').off('click').on('click', function (e) {
        e.stopPropagation(); // 아이템 클릭 이벤트 방지
        showHighlightItemMoreMenu(e);
    });
}

function getMessageLabel(mesId) {
    // mesId는 DOM의 mesid 속성값과 동일함 (chat 배열의 인덱스)
    const message = chat[mesId];
    if (!message) return `메시지#${mesId}`;

    let name = '';
    if (message.is_system) {
        return '시스템';
    } else if (message.is_user) {
        name = message.name || '나';
    } else {
        name = message.name || getCharacterName(this_chid);
    }

    return `${name}#${mesId}`;
}

// ⭐ 모바일 터치 이벤트 안정화를 위한 변수
let touchSelectionTimer = null;
let lastTouchEnd = 0;

function enableHighlightMode() {
    // 이벤트 위임 방식으로 변경 - 동적으로 로드되는 메시지에도 작동
    $(document).off('mouseup.hl touchend.hl', '.mes_text').on('mouseup.hl touchend.hl', '.mes_text', function (e) {
        const element = this;

        // 모바일 터치 이벤트의 경우 약간의 딜레이 추가
        const isTouchEvent = e.type === 'touchend';

        // ⭐ 터치 이벤트 중복 방지 - 같은 터치가 여러 번 발생하는 것 방지
        if (isTouchEvent) {
            const now = Date.now();
            if (now - lastTouchEnd < 300) {
                // 300ms 이내 중복 터치는 무시
                return;
            }
            lastTouchEnd = now;

            // 기존 타이머 제거
            if (touchSelectionTimer) {
                clearTimeout(touchSelectionTimer);
                touchSelectionTimer = null;
            }
        }

        const delay = isTouchEvent ? 150 : 0;

        const processSelection = () => {
            const sel = window.getSelection();
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
            const pageX = e.pageX || (e.originalEvent?.changedTouches?.[0]?.pageX) || e.clientX;
            const pageY = e.pageY || (e.originalEvent?.changedTouches?.[0]?.pageY) || e.clientY;

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
        };

        if (isTouchEvent) {
            // ⭐ 모바일: 타이머로 안정화
            touchSelectionTimer = setTimeout(processSelection, delay);
        } else {
            // 데스크탑: 즉시 실행
            setTimeout(processSelection, delay);
        }
    });
}

function disableHighlightMode() {
    $(document).off('mouseup.hl touchend.hl', '.mes_text');

    // ⭐ 대기 중인 터치 타이머 제거
    if (touchSelectionTimer) {
        clearTimeout(touchSelectionTimer);
        touchSelectionTimer = null;
    }
}

// 전역 변수: document click 핸들러 추적
let colorMenuDocClickHandler = null;

function showColorMenu(x, y, text, range, el) {
    // 기존 메뉴와 이벤트 제거
    removeColorMenu();

    const colors = getColors();
    const colorButtons = colors.map(c =>
        `<button class="hl-color-btn" data-color="${c.bg}" style="background: ${c.bg}"></button>`
    ).join('');

    const menu = `
        <div id="highlight-color-menu" style="left: ${x}px; top: ${y}px;">
            ${colorButtons}
        </div>
    `;

    $('body').append(menu);

    // 화면 밖으로 나가지 않도록 위치 조정
    const $menu = $('#highlight-color-menu');
    const rect = $menu[0].getBoundingClientRect();

    let adjustedX = x;
    let adjustedY = y;

    const margin = window.innerWidth <= 768 ? 20 : 10;

    // 오른쪽 경계 확인
    if (rect.right > window.innerWidth) {
        adjustedX = window.innerWidth - rect.width - margin;
    }

    // 왼쪽 경계 확인
    if (adjustedX < margin) {
        adjustedX = margin;
    }

    // 하단 경계 확인
    if (rect.bottom > window.innerHeight) {
        adjustedY = y - rect.height - margin;
    }

    // 상단 경계 확인
    if (adjustedY < margin) {
        adjustedY = margin;
    }

    $menu.css({ left: adjustedX + 'px', top: adjustedY + 'px' });

    $('.hl-color-btn').off('click').on('click', function (e) {
        e.stopPropagation();
        createHighlight(text, $(this).data('color'), range, el);
        removeColorMenu();
    });

    // document click 이벤트 등록 (추적 가능하도록)
    colorMenuDocClickHandler = function(e) {
        if (!$(e.target).closest('#highlight-color-menu').length) {
            removeColorMenu();
        }
    };

    setTimeout(() => {
        $(document).on('click.colorMenu', colorMenuDocClickHandler);
    }, 100);
}

function removeColorMenu() {
    $('#highlight-color-menu').remove();
    if (colorMenuDocClickHandler) {
        $(document).off('click.colorMenu', colorMenuDocClickHandler);
        colorMenuDocClickHandler = null;
    }
}

// 메시지 내에서 텍스트의 시작 위치(offset) 계산
function calculateTextOffset(mesElement, range) {
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

function createHighlight(text, color, range, el) {
    const $mes = $(el).closest('.mes');
    const mesId = getMesId($mes);
    const chatFile = getCurrentChatFile();
    const charId = this_chid;

    if (!chatFile || !charId) {
        toastr.error('채팅 정보를 가져올 수 없습니다');
        return;
    }

    const hlId = 'hl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    // 텍스트 시작 위치 계산
    const textOffset = calculateTextOffset(el, range);

    // range에서 줄바꿈을 보존하면서 텍스트 추출
    const clonedContents = range.cloneContents();

    // 임시 div에 넣어서 HTML 구조 확인
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(clonedContents);

    // ⭐ 이미지, style, script 등 불필요한 요소 제거
    const unwantedSelectors = [
        'img', 'style', 'script', 'svg', 'canvas', 'video', 'audio', 'iframe',
        '.custom-imageWrapper', '.custom-characterImage',
        '[class*="image"]', '[class*="media"]'
    ];
    unwantedSelectors.forEach(selector => {
        tempDiv.querySelectorAll(selector).forEach(el => el.remove());
    });

    // innerHTML에서 br과 블록 요소를 줄바꿈으로 변환
    let htmlText = tempDiv.innerHTML;

    // p 태그의 닫는 태그를 문단 구분(줄바꿈 2번)으로 변환
    htmlText = htmlText.replace(/<\/p>/gi, '\n\n');

    // br 태그와 그 뒤의 공백/줄바꿈을 단순 줄바꿈 1개로 변환
    htmlText = htmlText.replace(/<br\s*\/?>\s*/gi, '\n');

    // 다른 블록 요소의 닫는 태그를 단순 줄바꿈으로 변환
    htmlText = htmlText.replace(/<\/(div|li|h[1-6])>/gi, '\n');

    // 모든 HTML 태그 제거
    const textDiv = document.createElement('div');
    textDiv.innerHTML = htmlText;
    let actualText = textDiv.textContent || textDiv.innerText || '';

    // 연속된 줄바꿈 3개 이상을 2개로 정리 (문단 구분 최대화)
    actualText = actualText.replace(/\n{3,}/g, '\n\n');

    // 앞뒤 공백 제거
    actualText = actualText.trim();

    // ⭐ 텍스트가 너무 짧거나 비어있으면 경고
    if (actualText.length === 0) {
        toastr.warning('텍스트만 선택해주세요 (이미지나 HTML 코드는 제외됩니다)');
        return;
    }

    try {
        // 단일 노드인 경우
        if (range.startContainer === range.endContainer && range.startContainer.nodeType === 3) {
            const span = document.createElement('span');
            span.className = 'text-highlight';
            span.setAttribute('data-hl-id', hlId);
            span.setAttribute('data-color', color);
            span.style.backgroundColor = getBackgroundColorFromHex(color);
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
                    nodesToWrap.push(node);
                }
            }

            nodesToWrap.forEach((node) => {
                const span = document.createElement('span');
                span.className = 'text-highlight';
                span.setAttribute('data-hl-id', hlId);
                span.setAttribute('data-color', color);
                span.style.backgroundColor = getBackgroundColorFromHex(color);

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
        toastr.error('하이라이트 생성 실패');
        return;
    }

    // actualText 사용 (TreeWalker로 추출한 텍스트)
    // ⭐ 수정: 현재 메시지 라벨도 함께 저장
    saveHighlight(charId, chatFile, {
        id: hlId,
        mesId: mesId,
        swipeId: getCurrentSwipeId(mesId), // 스와이프 ID 저장
        text: actualText,
        color: color,
        note: '',
        label: getMessageLabel(mesId), // 라벨 저장
        timestamp: Date.now(),
        textOffset: textOffset // 텍스트 시작 위치
    });

    toastr.success('하이라이트 추가');

    if ($('#highlighter-panel').hasClass('visible')) {
        renderView();
    }

    // 드래그 해제 - 약간의 딜레이를 줘서 다음 드래그 이벤트가 정상 작동하도록 함
    setTimeout(() => {
        window.getSelection().removeAllRanges();
    }, 50);
}

function getMesId($mes) {
    const index = $mes.attr('mesid');
    if (index !== undefined) return parseInt(index);

    const mes = chat[$mes.index('.mes')];
    return mes?.mes_id || $mes.index('.mes');
}

function getCurrentSwipeId(mesId) {
    const message = chat[mesId];
    if (!message) return 0;

    // swipe_id가 현재 표시 중인 스와이프의 인덱스
    return message.swipe_id || 0;
}

// 16진수 색상 코드를 투명도가 적용된 rgba로 변환
function getBackgroundColorFromHex(hex) {
    const colors = getColors();
    const colorConfig = colors.find(c => c.bg === hex);

    if (colorConfig) {
        return hexToRgba(colorConfig.bg, colorConfig.opacity);
    }

    // 기본값
    return hexToRgba('#FFE4B5', 0.8);
}

function showHighlightContextMenu(hlId, x, y) {
    const result = findHighlightById(hlId);
    if (!result) {
        console.warn('[SillyTavern-Highlighter] Highlight not found:', hlId);
        return;
    }

    const hl = result.highlight;

    $('#highlight-context-menu').remove();

    if (!x) {
        const $el = $(`.text-highlight[data-hl-id="${hlId}"]`);
        if ($el.length) {
            const rect = $el[0].getBoundingClientRect();
            x = rect.left + rect.width / 2;
            y = rect.bottom + 5;
        } else {
            x = window.innerWidth / 2;
            y = window.innerHeight / 2;
        }
    }

    const menu = `
        <div id="highlight-context-menu" class="${getDarkModeClass()}" style="left: ${x}px; top: ${y}px;" data-hl-id="${hlId}" data-char-id="${result.charId}" data-chat-file="${result.chatFile}">
            <button class="hl-context-btn" data-action="color">
                <div class="hl-context-color-preview" style="background: ${hl.color}"></div>
                <span>색상 변경</span>
            </button>
            <button class="hl-context-btn" data-action="note">
                <i class="fa-solid fa-pen"></i>
                <span>메모 ${hl.note ? '수정' : '입력'}</span>
            </button>
            <button class="hl-context-btn" data-action="copy">
                <i class="fa-solid fa-copy"></i>
                <span>복사</span>
            </button>
            <button class="hl-context-btn hl-context-delete" data-action="delete">
                <i class="fa-solid fa-trash"></i>
                <span>삭제</span>
            </button>
        </div>
    `;

    $('body').append(menu);

    const $menu = $('#highlight-context-menu');
    const rect = $menu[0].getBoundingClientRect();

    // 메뉴의 좌측 상단이 커서 위치에 오도록 설정
    let finalX = x;
    let finalY = y;

    const margin = window.innerWidth <= 768 ? 20 : 10;

    // 좌우 경계 확인
    if (finalX < margin) finalX = margin;
    if (finalX + rect.width > window.innerWidth - margin) {
        finalX = window.innerWidth - rect.width - margin;
    }

    // 상하 경계 확인 - 공간이 부족하면 위에 표시
    if (finalY + rect.height > window.innerHeight - margin) {
        finalY = y - rect.height;
    }
    if (finalY < margin) finalY = margin;

    $menu.css({ left: finalX + 'px', top: finalY + 'px' });

    $('.hl-context-btn').off('click').on('click', function (e) {
        e.stopPropagation();
        const action = $(this).data('action');
        const $menu = $('#highlight-context-menu');
        const menuHlId = $menu.data('hlId');
        const menuCharId = $menu.data('charId');
        const menuChatFile = $menu.data('chatFile');

        switch (action) {
            case 'color':
                showColorChangeMenu(menuHlId, menuCharId, menuChatFile);
                break;
            case 'note':
                showNoteModal(menuHlId, menuCharId, menuChatFile);
                $('#highlight-context-menu').remove();
                break;
            case 'copy':
                showCopyModal(menuHlId, menuCharId, menuChatFile);
                $('#highlight-context-menu').remove();
                break;
            case 'delete':
                deleteHighlight(menuHlId, menuCharId, menuChatFile);
                $('#highlight-context-menu').remove();
                break;
        }
    });

    // 우클릭 방지
    $menu.on('contextmenu', function(e) {
        e.preventDefault();
    });

    setTimeout(() => $(document).one('click', () => $('#highlight-context-menu').remove()), 100);
}

function showColorChangeMenu(hlId, charId, chatFile) {
    const $menu = $('#highlight-context-menu');

    if ($menu.find('.hl-context-colors').length) {
        $menu.find('.hl-context-colors').remove();
        return;
    }

    const colors = getColors();
    const colorButtons = colors.map(c =>
        `<button class="hl-context-color-btn" data-color="${c.bg}" style="background: ${c.bg}"></button>`
    ).join('');

    const colorsHtml = `
        <div class="hl-context-colors">
            ${colorButtons}
        </div>
    `;

    $menu.find('[data-action="color"]').after(colorsHtml);

    $('.hl-context-color-btn').off('click').on('click', function (e) {
        e.stopPropagation();
        changeHighlightColor(hlId, $(this).data('color'), charId, chatFile);
        $('#highlight-context-menu').remove();
    });
}

function changeHighlightColor(hlId, color, charId, chatFile) {
    const result = findHighlightById(hlId);
    if (!result) return;

    const hl = result.highlight;
    hl.color = color;
    $(`.text-highlight[data-hl-id="${hlId}"]`).attr('data-color', color).css('background-color', getBackgroundColorFromHex(color));

    saveSettingsDebounced();

    if ($('#highlighter-panel').hasClass('visible')) renderView();

    toastr.success('색상 변경됨');
}

function showNoteModal(hlId, charId, chatFile) {
    const result = findHighlightById(hlId);
    if (!result) return;

    const hl = result.highlight;

    $('#highlight-note-modal').remove();

    const modal = `
        <div id="highlight-note-modal" class="hl-modal-overlay">
            <div class="hl-modal ${getDarkModeClass()}">
                <div class="hl-modal-header">
                    <h3>메모 ${hl.note ? '수정' : '입력'}</h3>
                    <button class="hl-modal-close">&times;</button>
                </div>
                <div class="hl-modal-body">
                    <textarea class="hl-note-textarea" placeholder="메모를 입력하세요...">${hl.note || ''}</textarea>
                </div>
                <div class="hl-modal-footer">
                    <button class="hl-modal-btn hl-modal-cancel">취소</button>
                    <button class="hl-modal-btn hl-modal-save">저장</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modal);

    const $textarea = $('.hl-note-textarea');
    const originalNote = hl.note || '';
    $textarea.focus();

    // 저장 버튼
    $('.hl-modal-save').on('click', function () {
        hl.note = $textarea.val();
        saveSettingsDebounced();

        if ($('#highlighter-panel').hasClass('visible')) renderView();

        $('#highlight-note-modal').remove();
        toastr.success('메모 저장됨');
    });

    // 닫기/취소 버튼 - 변경사항 확인
    const closeNoteModal = function () {
        const currentNote = $textarea.val();
        const hasChanges = currentNote !== originalNote;

        if (hasChanges && currentNote.trim().length > 0) {
            // 변경사항이 있으면 확인
            if (confirm('메모를 취소하시겠습니까?\n저장되지 않은 변경사항이 사라집니다.')) {
                $('#highlight-note-modal').remove();
            }
        } else {
            // 변경사항이 없거나 빈 메모면 바로 닫기
            $('#highlight-note-modal').remove();
        }
    };

    $('.hl-modal-close, .hl-modal-cancel').on('click', closeNoteModal);

    // 모달 밖 클릭 시 닫기
    $('.hl-modal-overlay').on('click', function (e) {
        if (e.target === this) {
            closeNoteModal();
        }
    });
}

function showCopyModal(hlId, charId, chatFile) {
    const result = findHighlightById(hlId);
    if (!result) return;

    const hl = result.highlight;
    const text = hl.note ? `${hl.text}\n\n메모: ${hl.note}` : hl.text;

    $('#highlight-copy-modal').remove();

    const modal = `
        <div id="highlight-copy-modal" class="hl-modal-overlay">
            <div class="hl-modal ${getDarkModeClass()}">
                <div class="hl-modal-header">
                    <h3>텍스트 복사</h3>
                    <button class="hl-modal-close">&times;</button>
                </div>
                <div class="hl-modal-body">
                    <textarea class="hl-copy-textarea" readonly>${text}</textarea>
                </div>
                <div class="hl-modal-footer">
                    <button class="hl-modal-btn hl-modal-select">전체 선택</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modal);

    $('.hl-modal-select').on('click', function () {
        $('.hl-copy-textarea').select();
    });

    $('.hl-modal-close, .hl-modal-overlay').on('click', function (e) {
        if (e.target === this) $('#highlight-copy-modal').remove();
    });

    setTimeout(() => $('.hl-copy-textarea').select(), 100);
}

function saveHighlight(charId, chatFile, hlData) {
    if (!settings.highlights[charId]) settings.highlights[charId] = {};
    if (!settings.highlights[charId][chatFile]) {
        settings.highlights[charId][chatFile] = {
            lastModified: Date.now(),
            highlights: []
        };
    }

    settings.highlights[charId][chatFile].highlights.push(hlData);
    settings.highlights[charId][chatFile].lastModified = Date.now();

    saveSettingsDebounced();
}

function deleteHighlight(hlId, charId, chatFile) {
    const result = findHighlightById(hlId);
    if (!result) return;

    const hl = result.highlight;
    const hlCharId = charId || result.charId;
    const hlChatFile = chatFile || result.chatFile;

    // 모달 생성
    $('#highlight-delete-modal').remove();

    const isDark = settings.darkMode;
    const textColor = isDark ? '#e0e0e0' : '#222';
    const bgColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    const noteColor = isDark ? '#b0b0b0' : '#666';

    const modal = `
        <div id="highlight-delete-modal" class="hl-modal-overlay">
            <div class="hl-modal ${getDarkModeClass()}">
                <div class="hl-modal-header">
                    <h3>하이라이트 삭제</h3>
                    <button class="hl-modal-close">&times;</button>
                </div>
                <div class="hl-modal-body">
                    <p style="margin: 0; padding: 10px; background: ${bgColor}; border-radius: 8px; line-height: 1.6; color: ${textColor} !important;">
                        <strong style="color: ${textColor} !important;">삭제할 하이라이트:</strong><br>
                        ${hl.text.substring(0, 100)}${hl.text.length > 100 ? '...' : ''}
                    </p>
                    ${hl.note ? `<p style="margin-top: 10px; color: ${noteColor} !important;"><strong style="color: ${textColor} !important;">메모:</strong> ${hl.note}</p>` : ''}
                    <p style="margin-top: 15px; color: #e74c3c !important; font-weight: 500;">정말로 삭제하시겠습니까?</p>
                </div>
                <div class="hl-modal-footer">
                    <button class="hl-modal-btn hl-modal-cancel">취소</button>
                    <button class="hl-modal-btn hl-modal-delete" style="background: #e74c3c; color: white;">삭제</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modal);

    $('.hl-modal-delete').on('click', function() {
        const chatData = settings.highlights[hlCharId]?.[hlChatFile];
        if (!chatData) return;

        chatData.highlights = chatData.highlights.filter(h => h.id !== hlId);
        chatData.lastModified = Date.now();

        $(`.text-highlight[data-hl-id="${hlId}"]`).contents().unwrap();

        saveSettingsDebounced();

        if ($('#highlighter-panel').hasClass('visible')) renderView();

        $('#highlight-delete-modal').remove();
        toastr.success('삭제됨');
    });

    $('.hl-modal-close, .hl-modal-cancel').on('click', function() {
        $('#highlight-delete-modal').remove();
    });

    $('.hl-modal-overlay').on('click', function(e) {
        if (e.target === this) $(this).remove();
    });
}

function deleteCharacterHighlights() {
    const charName = getCharacterName(selectedCharacter);
    const totalCount = getTotalHighlightsForCharacter(selectedCharacter);

    // 모달 생성
    $('#highlight-delete-all-modal').remove();

    const isDark = settings.darkMode;
    const textColor = isDark ? '#e0e0e0' : '#222';
    const secondaryColor = isDark ? '#b0b0b0' : '#666';
    const warningBg = isDark ? 'rgba(231, 76, 60, 0.2)' : 'rgba(231, 76, 60, 0.1)';
    const warningBorder = isDark ? 'rgba(231, 76, 60, 0.4)' : 'rgba(231, 76, 60, 0.3)';

    const modal = `
        <div id="highlight-delete-all-modal" class="hl-modal-overlay">
            <div class="hl-modal ${getDarkModeClass()}">
                <div class="hl-modal-header">
                    <h3>캐릭터 하이라이트 전체 삭제</h3>
                    <button class="hl-modal-close">&times;</button>
                </div>
                <div class="hl-modal-body">
                    <p style="margin: 0; padding: 15px; background: ${warningBg}; border-radius: 8px; line-height: 1.6; border: 1px solid ${warningBorder}; color: ${textColor} !important;">
                        <i class="fa-solid fa-exclamation-triangle" style="color: #e74c3c; margin-right: 8px;"></i>
                        <strong style="color: #e74c3c !important;">${charName}</strong> 캐릭터의 모든 하이라이트 <strong style="color: #e74c3c !important;">${totalCount}개</strong>가 삭제됩니다.
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

    $('.hl-modal-delete').on('click', function() {
        // DOM에서 하이라이트 제거
        const charHighlights = settings.highlights[selectedCharacter];
        if (charHighlights) {
            // 캐릭터의 모든 채팅에 대해 반복
            Object.values(charHighlights).forEach(chatData => {
                if (chatData && chatData.highlights) {
                    chatData.highlights.forEach(hl => {
                        const $highlights = $(`.text-highlight[data-hl-id="${hl.id}"]`);
                        $highlights.each(function() {
                            $(this).contents().unwrap();
                        });
                    });
                }
            });
        }

        delete settings.highlights[selectedCharacter];
        saveSettingsDebounced();

        navigateToCharacterList();
        $('#highlight-delete-all-modal').remove();
        toastr.success('캐릭터 하이라이트 전체 삭제됨');
    });

    $('.hl-modal-close, .hl-modal-cancel').on('click', function() {
        $('#highlight-delete-all-modal').remove();
    });

    $('.hl-modal-overlay').on('click', function(e) {
        if (e.target === this) $(this).remove();
    });
}

function deleteChatHighlights() {
    const chatData = settings.highlights[selectedCharacter]?.[selectedChat];
    if (!chatData) return;

    const highlightCount = chatData.highlights.length;

    // 모달 생성
    $('#highlight-delete-chat-modal').remove();

    const isDark = settings.darkMode;
    const textColor = isDark ? '#e0e0e0' : '#222';
    const secondaryColor = isDark ? '#b0b0b0' : '#666';
    const warningBg = isDark ? 'rgba(231, 76, 60, 0.2)' : 'rgba(231, 76, 60, 0.1)';
    const warningBorder = isDark ? 'rgba(231, 76, 60, 0.4)' : 'rgba(231, 76, 60, 0.3)';

    const modal = `
        <div id="highlight-delete-chat-modal" class="hl-modal-overlay">
            <div class="hl-modal ${getDarkModeClass()}">
                <div class="hl-modal-header">
                    <h3>채팅 하이라이트 전체 삭제</h3>
                    <button class="hl-modal-close">&times;</button>
                </div>
                <div class="hl-modal-body">
                    <p style="margin: 0; padding: 15px; background: ${warningBg}; border-radius: 8px; line-height: 1.6; border: 1px solid ${warningBorder}; color: ${textColor} !important;">
                        <i class="fa-solid fa-exclamation-triangle" style="color: #e74c3c; margin-right: 8px;"></i>
                        <strong style="color: #e74c3c !important;">${selectedChat}</strong> 채팅의 모든 하이라이트 <strong style="color: #e74c3c !important;">${highlightCount}개</strong>가 삭제됩니다.
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

    $('.hl-modal-delete').on('click', function() {
        // DOM에서 하이라이트 제거
        chatData.highlights.forEach(hl => {
            const $highlights = $(`.text-highlight[data-hl-id="${hl.id}"]`);
            $highlights.each(function() {
                $(this).contents().unwrap();
            });
        });

        delete settings.highlights[selectedCharacter][selectedChat];
        saveSettingsDebounced();

        navigateToChatList(selectedCharacter);
        $('#highlight-delete-chat-modal').remove();
        toastr.success('채팅 하이라이트 전체 삭제됨');
    });

    $('.hl-modal-close, .hl-modal-cancel').on('click', function() {
        $('#highlight-delete-chat-modal').remove();
    });

    $('.hl-modal-overlay').on('click', function(e) {
        if (e.target === this) $(this).remove();
    });
}

async function jumpToMessage(mesId, hlId) {
    // 모바일에서 패널 닫기
    if (window.innerWidth <= 768) {
        closePanel();
    }

    // hlId로 하이라이트가 속한 캐릭터/채팅 찾기
    const result = hlId ? findHighlightById(hlId) : null;
    const targetCharId = result ? result.charId : selectedCharacter;
    const targetChatFile = result ? result.chatFile : selectedChat;

    const currentCharId = this_chid;
    const currentChatFile = getCurrentChatFile();

    // 타입 변환 (문자열로 통일)
    const targetCharIdStr = targetCharId !== null && targetCharId !== undefined ? String(targetCharId) : null;
    const currentCharIdStr = currentCharId !== null && currentCharId !== undefined ? String(currentCharId) : null;

    // 같은 캐릭터이고 같은 채팅인 경우 바로 점프 (불필요한 이동 방지)
    if (targetCharIdStr === currentCharIdStr && targetChatFile === currentChatFile) {
        jumpToMessageInternal(mesId, hlId);
        return;
    }

    // 캐릭터가 다른 경우 캐릭터 변경
    if (targetCharId !== currentCharId && targetCharId !== null) {
        const charName = getCharacterName(targetCharId);

        // 캐릭터가 삭제되었는지 확인
        if (charName === 'Unknown' || !characters[targetCharId]) {
            showDeletedChatAlert('character', charName || '알 수 없음', targetChatFile);
            return;
        }

        toastr.info(`${charName} 캐릭터로 이동 중...`);

        try {
            // SillyTavern API를 사용하여 캐릭터 변경
            await executeSlashCommandsWithOptions(`/char ${charName}`);

            // 캐릭터 로딩 대기
            await new Promise(resolve => setTimeout(resolve, 1500));
        } catch (error) {
            console.error('[SillyTavern-Highlighter] Character change error:', error);
            toastr.error('캐릭터 변경 실패: ' + error.message);
            return;
        }
    }

    // 채팅이 다른 경우 - 자동으로 채팅 전환
    if (targetChatFile && targetChatFile !== getCurrentChatFile()) {
        toastr.info(`${targetChatFile} 채팅으로 전환 중...`);

        try {
            const context = getContext();

            // SillyTavern API 가져오기
            const { openCharacterChat, openGroupChat } = SillyTavern.getContext();

            // 그룹 채팅인 경우
            if (context.groupId && typeof openGroupChat === 'function') {
                await openGroupChat(context.groupId, targetChatFile);
            }
            // 캐릭터 채팅인 경우
            else if (context.characterId !== undefined && typeof openCharacterChat === 'function') {
                await openCharacterChat(targetChatFile);
            }
            else {
                throw new Error('채팅 전환 API를 사용할 수 없습니다');
            }

            // 채팅 전환 대기
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 전환 성공 확인
            if (getCurrentChatFile() === targetChatFile) {
                jumpToMessageInternal(mesId, hlId);
                return;
            } else {
                throw new Error('채팅 전환이 완료되지 않았습니다');
            }
        } catch (error) {
            console.error('[SillyTavern-Highlighter] Chat switch error:', error);
            toastr.warning(
                `다른 채팅의 하이라이트입니다.<br>` +
                `<strong>${targetChatFile}</strong> 채팅으로 수동으로 전환한 후<br>` +
                `다시 시도해주세요.`,
                '채팅 전환 실패',
                {
                    timeOut: 8000,
                    extendedTimeOut: 3000,
                    escapeHtml: false
                }
            );
            return;
        }
    }

    // 같은 캐릭터/채팅인 경우 바로 점프
    jumpToMessageInternal(mesId, hlId);
}


function showDeletedChatAlert(type, charName, chatFile) {
    $('#highlight-deleted-alert-modal').remove();

    const title = type === 'character' ? '캐릭터가 삭제되었습니다' : '채팅이 삭제되었습니다';
    const message = type === 'character'
        ? `<p>이 하이라이트가 속한 캐릭터 <strong>"${charName}"</strong>가 삭제되었거나 찾을 수 없습니다.</p>
           <p>하이라이트는 독서노트 패널에 보관되어 있으며, 원하시면 삭제할 수 있습니다.</p>`
        : `<p>이 하이라이트가 속한 채팅 <strong>"${chatFile}"</strong>이 삭제되었거나 찾을 수 없습니다.</p>
           <p>하이라이트는 독서노트 패널에 보관되어 있으며, 원하시면 삭제할 수 있습니다.</p>`;

    const modal = `
        <div id="highlight-deleted-alert-modal" class="hl-modal-overlay">
            <div class="hl-modal ${getDarkModeClass()}" style="max-width: 500px;">
                <div class="hl-modal-header">
                    <h3><i class="fa-solid fa-triangle-exclamation" style="color: #ff9800;"></i> ${title}</h3>
                    <button class="hl-modal-close"><i class="fa-solid fa-times"></i></button>
                </div>
                <div class="hl-modal-body">
                    ${message}
                </div>
                <div class="hl-modal-footer">
                    <button class="hl-modal-btn hl-modal-confirm">확인</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modal);

    $('.hl-modal-close, .hl-modal-confirm').on('click', function() {
        $('#highlight-deleted-alert-modal').remove();
    });

    $('.hl-modal-overlay').on('click', function (e) {
        if (e.target === this) $(this).remove();
    });
}

async function jumpToMessageInternal(mesId, hlId) {
    const $mes = $(`.mes[mesid="${mesId}"]`);

    if ($mes.length) {
        // hlId가 있으면 먼저 하이라이트 데이터 검증
        if (hlId) {
            const result = findHighlightById(hlId);

            if (result) {
                const hlText = result.highlight.text;
                const mesText = $mes.find('.mes_text').text();

                // 줄바꿈 정규화 후 비교
                const normalizedHlText = hlText.replace(/\n+/g, ' ').trim();
                const normalizedMesText = mesText.replace(/\s+/g, ' ').trim();

                // 메시지에 하이라이트 텍스트가 존재하는지 확인
                if (!normalizedMesText.includes(normalizedHlText)) {
                    // 메시지가 변경되었거나 삭제됨
                    toastr.warning(
                        '이 하이라이트가 저장된 메시지가 삭제되었거나 내용이 변경되었습니다.<br>' +
                        '하이라이트를 삭제하는 것을 권장합니다.',
                        '하이라이트 불일치',
                        {
                            timeOut: 8000,
                            extendedTimeOut: 3000,
                            escapeHtml: false
                        }
                    );

                    // 메시지로 이동은 하되 플래시 효과는 약하게
                    $mes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return;
                }
            }

            // 하이라이트가 유효한 경우 해당 하이라이트로 스크롤
            const $highlight = $mes.find(`.text-highlight[data-hl-id="${hlId}"]`).first();
            if ($highlight.length) {
                $highlight[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                $highlight.addClass('flash-highlight');
                setTimeout(() => $highlight.removeClass('flash-highlight'), 2000);
            } else {
                // 하이라이트를 찾지 못하면 메시지로 스크롤
                $mes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                $mes.addClass('flash-highlight');
                setTimeout(() => $mes.removeClass('flash-highlight'), 2000);
            }
        } else {
            $mes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            $mes.addClass('flash-highlight');
            setTimeout(() => $mes.removeClass('flash-highlight'), 2000);
        }
        toastr.info('메시지로 이동');
    } else {
        // 메시지가 로드되지 않은 경우 /chat-jump 명령어 사용
        toastr.info('메시지를 불러오는 중...');

        try {
            // executeSlashCommandsWithOptions를 사용하여 명령어 실행
            await executeSlashCommandsWithOptions(`/chat-jump ${mesId}`);

            // 약간의 지연 후 스크롤 시도
            setTimeout(() => {
                const $retryMes = $(`.mes[mesid="${mesId}"]`);
                if ($retryMes.length) {
                    if (hlId) {
                        // 하이라이트 데이터 검증
                        const result = findHighlightById(hlId);

                        if (result) {
                            const hlText = result.highlight.text;
                            const mesText = $retryMes.find('.mes_text').text();

                            // 줄바꿈 정규화 후 비교
                            const normalizedHlText = hlText.replace(/\n+/g, ' ').trim();
                            const normalizedMesText = mesText.replace(/\s+/g, ' ').trim();

                            // 메시지에 하이라이트 텍스트가 존재하는지 확인
                            if (!normalizedMesText.includes(normalizedHlText)) {
                                toastr.warning(
                                    '이 하이라이트가 저장된 메시지가 삭제되었거나 내용이 변경되었습니다.<br>' +
                                    '하이라이트를 삭제하는 것을 권장합니다.',
                                    '하이라이트 불일치',
                                    {
                                        timeOut: 8000,
                                        extendedTimeOut: 3000,
                                        escapeHtml: false
                                    }
                                );
                                $retryMes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                                return;
                            }
                        }

                        const $highlight = $retryMes.find(`.text-highlight[data-hl-id="${hlId}"]`).first();
                        if ($highlight.length) {
                            $highlight[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                            $highlight.addClass('flash-highlight');
                            setTimeout(() => $highlight.removeClass('flash-highlight'), 2000);
                        } else {
                            $retryMes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                            $retryMes.addClass('flash-highlight');
                            setTimeout(() => $retryMes.removeClass('flash-highlight'), 2000);
                        }
                    } else {
                        $retryMes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                        $retryMes.addClass('flash-highlight');
                        setTimeout(() => $retryMes.removeClass('flash-highlight'), 2000);
                    }
                    toastr.info('메시지로 이동');
                } else {
                    toastr.warning('메시지를 찾을 수 없습니다');
                }
            }, 1000);
        } catch (error) {
            console.error('[SillyTavern-Highlighter] Jump error:', error);
            toastr.error('/chat-jump 명령어 실패: ' + error.message);
        }
    }
}

function showBackupModal() {
    $('#highlight-backup-modal').remove();

    const modal = `
        <div id="highlight-backup-modal" class="hl-modal-overlay">
            <div class="hl-modal ${getDarkModeClass()}">
                <div class="hl-modal-header">
                    <h3>하이라이트 백업</h3>
                    <button class="hl-modal-close">&times;</button>
                </div>
                <div class="hl-modal-body">
                    <div style="margin-bottom: 20px;">
                        <label class="hl-modal-label-title">파일 형식:</label>
                        <label class="hl-modal-label-option">
                            <input type="radio" name="backup-format" value="json" checked style="margin-right: 8px;">
                            JSON (복원 가능)
                        </label>
                        <label class="hl-modal-label-option">
                            <input type="radio" name="backup-format" value="txt" style="margin-right: 8px;">
                            TXT (감상용, 복원 불가)
                        </label>
                    </div>
                    <div>
                        <label class="hl-modal-label-title">백업 범위:</label>
                        <label class="hl-modal-label-option">
                            <input type="radio" name="backup-scope" value="all" checked style="margin-right: 8px;">
                            전체
                        </label>
                        <label class="hl-modal-label-option">
                            <input type="radio" name="backup-scope" value="character" ${!selectedCharacter ? 'disabled' : ''} style="margin-right: 8px;">
                            현재 캐릭터만 ${!selectedCharacter ? '(선택된 캐릭터 없음)' : ''}
                        </label>
                        <label class="hl-modal-label-option">
                            <input type="radio" name="backup-scope" value="chat" ${!selectedChat ? 'disabled' : ''} style="margin-right: 8px;">
                            현재 채팅만 ${!selectedChat ? '(선택된 채팅 없음)' : ''}
                        </label>
                    </div>
                </div>
                <div class="hl-modal-footer">
                    <button class="hl-modal-btn hl-modal-cancel">취소</button>
                    <button class="hl-modal-btn hl-modal-save">백업하기</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modal);

    $('.hl-modal-save').on('click', function() {
        const format = $('input[name="backup-format"]:checked').val();
        const scope = $('input[name="backup-scope"]:checked').val();

        if (format === 'json') {
            exportHighlightsJSON(scope);
        } else {
            exportHighlightsTXT(scope);
        }

        $('#highlight-backup-modal').remove();
    });

    $('.hl-modal-close, .hl-modal-cancel').on('click', function() {
        $('#highlight-backup-modal').remove();
    });

    $('.hl-modal-overlay').on('click', function(e) {
        if (e.target === this) $(this).remove();
    });
}

function exportHighlightsJSON(scope) {
    let dataToExport = {};
    let scopeName = '전체';

    if (scope === 'all') {
        dataToExport = settings.highlights;
        scopeName = '전체';
    } else if (scope === 'character' && selectedCharacter) {
        dataToExport[selectedCharacter] = settings.highlights[selectedCharacter];
        scopeName = getCharacterName(selectedCharacter);
    } else if (scope === 'chat' && selectedCharacter && selectedChat) {
        dataToExport[selectedCharacter] = {
            [selectedChat]: settings.highlights[selectedCharacter]?.[selectedChat]
        };
        scopeName = `${getCharacterName(selectedCharacter)}_${selectedChat}`;
    }

    const data = {
        version: '1.0.0',
        exportDate: Date.now(),
        scope: scope,
        highlights: dataToExport
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const a = document.createElement('a');
    a.href = url;
    a.download = `highlights_${scopeName}_${timestamp}.json`;
    a.click();

    URL.revokeObjectURL(url);
    toastr.success('JSON 백업 완료');
}

function exportHighlightsTXT(scope) {
    let content = '';
    const now = new Date();
    const dateStr = now.toLocaleString('ko-KR');

    let scopeName = '전체';
    let totalHighlights = 0;
    let totalCharacters = 0;
    let totalChats = 0;

    // 헤더
    content += '===========================================\n';
    content += '독서노트 하이라이트 모음\n';
    content += `생성일: ${dateStr}\n`;

    // 데이터 수집
    let dataToExport = {};

    if (scope === 'all') {
        dataToExport = settings.highlights;
        scopeName = '전체';
    } else if (scope === 'character' && selectedCharacter) {
        dataToExport[selectedCharacter] = settings.highlights[selectedCharacter];
        scopeName = getCharacterName(selectedCharacter);
    } else if (scope === 'chat' && selectedCharacter && selectedChat) {
        dataToExport[selectedCharacter] = {
            [selectedChat]: settings.highlights[selectedCharacter]?.[selectedChat]
        };
        scopeName = `${getCharacterName(selectedCharacter)} > ${selectedChat}`;
    }

    content += `범위: ${scopeName}\n`;
    content += '===========================================\n\n';

    // 하이라이트 내용
    let charIds = Object.keys(dataToExport);

    // 캐릭터 정렬
    const charSortOption = settings.sortOptions?.characters || 'modified';
    if (charSortOption === 'name') {
        charIds.sort((a, b) => {
            const nameA = getCharacterName(a);
            const nameB = getCharacterName(b);
            return nameA.localeCompare(nameB, 'ko-KR');
        });
    } else {
        charIds.sort((a, b) => {
            const chatsA = dataToExport[a];
            const chatsB = dataToExport[b];
            const lastModifiedA = Math.max(...Object.values(chatsA).map(c => c.lastModified || 0));
            const lastModifiedB = Math.max(...Object.values(chatsB).map(c => c.lastModified || 0));
            return lastModifiedB - lastModifiedA;
        });
    }

    charIds.forEach(charId => {
        const charName = getCharacterName(charId);
        const chatData = dataToExport[charId];

        if (!chatData) return;

        totalCharacters++;

        let chatFiles = Object.keys(chatData);

        // 채팅 정렬
        const chatSortOption = settings.sortOptions?.chats || 'modified';
        if (chatSortOption === 'name') {
            chatFiles.sort((a, b) => a.localeCompare(b, 'ko-KR'));
        } else {
            chatFiles.sort((a, b) => {
                const lastModifiedA = chatData[a].lastModified || 0;
                const lastModifiedB = chatData[b].lastModified || 0;
                return lastModifiedB - lastModifiedA;
            });
        }

        chatFiles.forEach(chatFile => {
            let highlights = chatData[chatFile]?.highlights || [];

            if (highlights.length === 0) return;

            totalChats++;

            // 하이라이트 정렬
            const hlSortOption = settings.sortOptions?.highlights || 'created';
            if (hlSortOption === 'message') {
                highlights = [...highlights].sort((a, b) => {
                    // 같은 메시지 내에서는 생성 시간 순서(텍스트 순서)대로
                    if (a.mesId !== b.mesId) {
                        return a.mesId - b.mesId;
                    }
                    return (a.timestamp || 0) - (b.timestamp || 0);
                });
            } else {
                highlights = [...highlights].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            }

            content += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
            content += `[${charName} > ${chatFile}]\n`;
            content += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

            highlights.forEach(hl => {
                totalHighlights++;

                const date = new Date(hl.timestamp).toLocaleDateString('ko-KR');
                const label = hl.label || `메시지#${hl.mesId}`;

                content += `▌ ${label} | ${date}\n`;
                content += `${hl.text}\n`;

                if (hl.note && hl.note.trim()) {
                    content += `\n📝 메모: ${hl.note}\n`;
                }

                content += '\n──────────────────────────────────────────\n\n';
            });

            content += '\n';
        });
    });

    // 푸터
    content += '===========================================\n';
    content += `총 하이라이트: ${totalHighlights}개\n`;
    content += `총 캐릭터: ${totalCharacters}개\n`;
    content += `총 채팅: ${totalChats}개\n`;
    content += '===========================================\n';

    // 파일 다운로드
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const fileName = scopeName.replace(/[\\/:*?"<>|]/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `highlights_${fileName}_${timestamp}.txt`;
    a.click();

    URL.revokeObjectURL(url);
    toastr.success('TXT 백업 완료');
}

// 기존 함수 호환성을 위해 유지
function exportHighlights() {
    showBackupModal();
}

function importHighlights(file) {
    const reader = new FileReader();

    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);

            if (!data.version || !data.highlights) {
                throw new Error('잘못된 파일');
            }

            if (confirm('기존 데이터와 병합하시겠습니까?\n취소를 누르면 덮어씁니다.')) {
                settings.highlights = deepMerge(settings.highlights, data.highlights);
            } else {
                settings.highlights = data.highlights;
            }

            saveSettingsDebounced();
            renderView();

            // 채팅 내 하이라이트 복원 (약간의 딜레이로 확실하게)
            setTimeout(() => {
                restoreHighlightsInChat();
            }, 300);

            toastr.success('불러오기 완료');

        } catch (error) {
            toastr.error('파일 오류: ' + error.message);
        }
    };

    reader.readAsText(file);
    $('#hl-import-file-input').val('');
}

function getCurrentChatFile() {
    const context = getContext();
    return context.chatId || context.chat_metadata?.file_name || null;
}

function getCharacterName(charId) {
    return characters[charId]?.name || 'Unknown';
}

function getTotalHighlightsForCharacter(charId) {
    const chats = settings.highlights[charId];
    if (!chats) return 0;

    return Object.values(chats).reduce((total, chatData) => {
        return total + (chatData.highlights?.length || 0);
    }, 0);
}

function findHighlightById(hlId) {
    // 먼저 현재 선택된 캐릭터/채팅에서 찾기
    if (selectedCharacter && selectedChat) {
        const chatData = settings.highlights[selectedCharacter]?.[selectedChat];
        if (chatData) {
            const found = chatData.highlights.find(h => h.id === hlId);
            if (found) return { highlight: found, charId: selectedCharacter, chatFile: selectedChat };
        }
    }

    // 현재 열린 채팅에서 찾기
    const currentCharId = this_chid;
    const currentChatFile = getCurrentChatFile();

    if (currentCharId && currentChatFile) {
        const chatData = settings.highlights[currentCharId]?.[currentChatFile];
        if (chatData) {
            const found = chatData.highlights.find(h => h.id === hlId);
            if (found) return { highlight: found, charId: currentCharId, chatFile: currentChatFile };
        }
    }

    // 그래도 없으면 모든 캐릭터와 채팅을 검색
    for (const charId in settings.highlights) {
        for (const chatFile in settings.highlights[charId]) {
            const chatData = settings.highlights[charId][chatFile];
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

function deepMerge(target, source) {
    const result = { ...target };

    for (const key in source) {
        if (source.hasOwnProperty(key)) {
            if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
    }

    return result;
}

// ⭐⭐ 메시지 내용 기반 체크포인트/분기 감지 (경량화, mesId 독립적)
function detectCheckpointOrBranch(currentChat, otherChatFile, charId) {
    try {
        console.log(`[SillyTavern-Highlighter] 🔍 Analyzing "${otherChatFile}"...`);

        if (currentChat.length < 3) {
            console.log(`[SillyTavern-Highlighter] ❌ Too few messages (${currentChat.length})`);
            return null;
        }

        // 다른 채팅과 비교할 필요가 있는지 빠른 체크
        const otherHighlights = settings.highlights[charId]?.[otherChatFile]?.highlights || [];
        if (otherHighlights.length === 0) {
            console.log(`[SillyTavern-Highlighter] ❌ No highlights in "${otherChatFile}"`);
            return null;
        }

        console.log(`[SillyTavern-Highlighter] Found ${otherHighlights.length} highlight(s) in "${otherChatFile}"`);

        // ⭐⭐ 전체 메시지를 비교 (범위 제한 없음)
        // 현재 채팅의 모든 메시지 텍스트 수집 (HTML 태그 제거 후 정규화)
        const currentMessages = currentChat.map(m => {
            let text = m.mes || '';

            // ⭐ HTML 태그 제거 (하이라이트 생성 시와 동일한 방식)
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = text;
            text = tempDiv.textContent || tempDiv.innerText || '';

            return text.replace(/\s+/g, ' ').trim();
        }).filter(t => t.length > 10); // 너무 짧은 메시지는 제외

        if (currentMessages.length === 0) {
            console.log(`[SillyTavern-Highlighter] ❌ No valid messages to compare`);
            return null;
        }

        console.log(`[SillyTavern-Highlighter] Comparing ${currentMessages.length} message(s) (full chat)...`);

        // 하이라이트 텍스트 중 현재 채팅에 존재하는 것 개수 세기
        let matchCount = 0;
        const totalToCheck = Math.min(otherHighlights.length, 15); // 최대 15개 하이라이트 확인

        for (let i = 0; i < totalToCheck; i++) {
            const hl = otherHighlights[i];
            const hlText = hl.text.replace(/\s+/g, ' ').trim();

            if (hlText.length < 10) {
                continue; // 너무 짧은 하이라이트는 스킵
            }

            // 현재 채팅의 어떤 메시지든 이 하이라이트 텍스트를 포함하는지 확인
            const found = currentMessages.some(mesText => mesText.includes(hlText));

            if (found) {
                matchCount++;
            }
        }

        // 일치율 계산
        const matchRatio = totalToCheck > 0 ? matchCount / totalToCheck : 0;
        console.log(`[SillyTavern-Highlighter] Match result: ${matchCount}/${totalToCheck} = ${(matchRatio * 100).toFixed(1)}%`);

        // 70% 이상 일치하면 체크포인트/분기로 판단 (80%에서 70%로 완화)
        if (matchRatio >= 0.7) {
            console.log(`[SillyTavern-Highlighter] ✅ Checkpoint/branch detected: ${otherChatFile} (match ratio: ${(matchRatio * 100).toFixed(1)}%)`);
            return { chatFile: otherChatFile, matchRatio: matchRatio }; // ⭐ 일치율도 함께 반환
        }

        console.log(`[SillyTavern-Highlighter] ❌ Match ratio too low (need ≥70%)`);
        return null;
    } catch (error) {
        console.warn('[SillyTavern-Highlighter] Error detecting checkpoint:', error);
        return null; // 오류 시 조용히 실패
    }
}

function restoreHighlightsInChat() {
    const chatFile = getCurrentChatFile();
    const charId = this_chid;

    if (!chatFile || !charId) return;

    // ⭐ 현재 채팅 파일의 하이라이트
    let currentChatHighlights = settings.highlights[charId]?.[chatFile]?.highlights || [];

    // ⭐⭐ 체크포인트/분기 자동 복사 (안전하고 경량화됨)
    const shouldCheckForCopy = currentChatHighlights.length === 0 && chat && chat.length >= 3;

    if (shouldCheckForCopy && settings.highlights[charId]) {
        console.log(`[SillyTavern-Highlighter] Checking for checkpoint/branch... (current chat: ${chatFile}, messages: ${chat.length})`);

        try {
            // 다른 채팅 파일들 중에서 체크포인트/분기 찾기
            let sourceChatFile = null;
            let bestMatchRatio = 0;
            const otherChatFiles = Object.keys(settings.highlights[charId]).filter(f => f !== chatFile);
            console.log(`[SillyTavern-Highlighter] Found ${otherChatFiles.length} other chat file(s) to check:`, otherChatFiles);

            // ⭐ 모든 채팅을 검사하여 가장 일치율이 높은 것 선택
            for (const otherChatFile in settings.highlights[charId]) {
                if (otherChatFile === chatFile) continue;

                const result = detectCheckpointOrBranch(chat, otherChatFile, charId);
                // ⭐ 안전 장치: result가 객체이고 필요한 필드를 가지고 있는지 확인
                if (result && typeof result === 'object' && result.chatFile && typeof result.matchRatio === 'number') {
                    if (result.matchRatio > bestMatchRatio) {
                        sourceChatFile = result.chatFile;
                        bestMatchRatio = result.matchRatio;
                    }
                }
            }

            if (sourceChatFile) {
                console.log(`[SillyTavern-Highlighter] Best match: "${sourceChatFile}" (${(bestMatchRatio * 100).toFixed(1)}%)`);
            }

            // 체크포인트/분기가 감지되면 하이라이트 복사
            if (sourceChatFile) {
                console.log(`[SillyTavern-Highlighter] ✅ Checkpoint/branch confirmed: ${sourceChatFile}`);
                const copiedHighlights = [];
                const sourceHighlights = settings.highlights[charId][sourceChatFile]?.highlights || [];
                console.log(`[SillyTavern-Highlighter] Attempting to copy ${sourceHighlights.length} highlight(s)...`);

                // ⭐⭐ 분기/체크포인트에서는 mesId가 달라질 수 있으므로 메시지 내용으로 매칭
                sourceHighlights.forEach((hl, idx) => {
                    const normalizedHlText = hl.text.replace(/\s+/g, ' ').trim();
                    let foundMesId = null;
                    let foundSwipeId = null;

                    // 현재 채팅의 모든 메시지를 순회하며 하이라이트 텍스트를 포함하는 메시지 찾기
                    for (let mesId = 0; mesId < chat.length; mesId++) {
                        const message = chat[mesId];
                        if (!message || !message.mes) continue;

                        // ⭐ HTML 태그 제거 후 메시지 텍스트 정규화
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = message.mes;
                        const mesTextContent = tempDiv.textContent || tempDiv.innerText || '';
                        const mesText = mesTextContent.replace(/\s+/g, ' ').trim();

                        // 하이라이트 텍스트가 포함되어 있는지 확인
                        if (mesText.includes(normalizedHlText)) {
                            foundMesId = mesId;
                            foundSwipeId = message.swipe_id || 0;
                            break; // 첫 번째 일치하는 메시지 사용
                        }
                    }

                    // 일치하는 메시지를 찾았으면 하이라이트 복사
                    if (foundMesId !== null) {
                        // 중복 방지
                        const isDuplicate = copiedHighlights.some(existing =>
                            existing.mesId === foundMesId &&
                            existing.text.replace(/\s+/g, ' ').trim() === normalizedHlText
                        );

                        if (!isDuplicate) {
                            // 새 ID와 새 mesId로 복사
                            const copiedHl = {
                                ...hl,
                                id: 'hl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                                mesId: foundMesId, // ⭐ 새 mesId로 업데이트
                                swipeId: foundSwipeId, // ⭐ 새 swipeId로 업데이트
                                label: getMessageLabel(foundMesId), // ⭐ 새 라벨로 업데이트
                                timestamp: Date.now()
                            };
                            copiedHighlights.push(copiedHl);
                            console.log(`[SillyTavern-Highlighter] Copied highlight ${idx + 1}: old mesId=${hl.mesId} → new mesId=${foundMesId}`);
                        }
                    } else {
                        console.warn(`[SillyTavern-Highlighter] Could not find message for highlight ${idx + 1}: "${normalizedHlText.substring(0, 50)}..."`);
                    }
                });

                // ⭐⭐ 복사된 하이라이트를 현재 채팅에 저장 (기존 데이터 절대 건드리지 않음)
                if (copiedHighlights.length > 0) {
                    if (!settings.highlights[charId]) settings.highlights[charId] = {};
                    if (!settings.highlights[charId][chatFile]) {
                        settings.highlights[charId][chatFile] = {
                            lastModified: Date.now(),
                            highlights: []
                        };
                    }

                    // 기존 하이라이트는 유지하고 새로운 것만 추가
                    settings.highlights[charId][chatFile].highlights = copiedHighlights;
                    settings.highlights[charId][chatFile].lastModified = Date.now();
                    currentChatHighlights = copiedHighlights;

                    saveSettingsDebounced();
                    console.log(`[SillyTavern-Highlighter] Auto-copied ${copiedHighlights.length} highlight(s) from checkpoint/branch: ${sourceChatFile}`);

                    // 사용자에게 알림
                    toastr.info(`${copiedHighlights.length}개의 하이라이트를 자동으로 복사했습니다`, '체크포인트/분기 감지', { timeOut: 3000 });
                }
            }
        } catch (error) {
            // 오류 발생 시 조용히 실패 (사용자에게 영향 없음)
            console.warn('[SillyTavern-Highlighter] Error during auto-copy:', error);
        }
    }

    // ⭐ 화면에 하이라이트 표시
    const allHighlights = [...currentChatHighlights];

    allHighlights.forEach(hl => {
        const $mes = $(`.mes[mesid="${hl.mesId}"]`);
        if ($mes.length) {
            // 스와이프 ID 확인 - 현재 표시 중인 스와이프와 일치하는 경우만 하이라이트
            const currentSwipeId = getCurrentSwipeId(hl.mesId);
            const hlSwipeId = hl.swipeId !== undefined ? hl.swipeId : 0; // 하위 호환성

            if (currentSwipeId !== hlSwipeId) {
                return; // 다른 스와이프는 스킵
            }

            const $text = $mes.find('.mes_text');

            const content = $text.html();
            if (!content) return;

            // ⭐ 성능 최적화: 이미 하이라이트가 적용된 경우 스킵
            if ($text.find(`.text-highlight[data-hl-id="${hl.id}"]`).length > 0) {
                return;
            }

            // 텍스트 컨텐츠 가져오기 (줄바꿈 정규화)
            const textContent = $text.text();
            const normalizedHlText = hl.text.replace(/\n+/g, ' ').trim();
            const normalizedMesText = textContent.replace(/\s+/g, ' ').trim();

            // 정규화된 텍스트로 매칭 확인
            if (normalizedMesText.includes(normalizedHlText)) {
                try {
                    highlightTextInElement($text[0], hl.text, hl.id, hl.color);
                } catch (e) {
                    console.warn('[SillyTavern-Highlighter] Failed to restore highlight:', e);
                }
            }
        }
    });

    // 이벤트는 위임으로 처리되므로 여기서는 바인딩 불필요
}

// 여러 문단에 걸친 텍스트를 하이라이트하는 헬퍼 함수
function highlightTextInElement(element, searchText, hlId, color) {
    const bgColor = getBackgroundColorFromHex(color);

    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    const textNodes = [];
    let fullText = '';

    while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
        fullText += walker.currentNode.textContent;
    }

    // 줄바꿈 정규화 및 매핑 테이블 생성
    const normalizedSearchText = searchText.replace(/\s+/g, ' ').trim();
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
    const normalizedStartIndex = normalizedFullText.indexOf(normalizedSearchText);
    if (normalizedStartIndex === -1) return;

    const normalizedEndIndex = normalizedStartIndex + normalizedSearchText.length;

    // 매핑 테이블을 사용해 실제 인덱스 계산
    const startIndex = indexMap[normalizedStartIndex] || 0;
    const endIndex = indexMap[normalizedEndIndex - 1] + 1 || fullText.length;

    let currentIndex = 0;

    textNodes.forEach(node => {
        const nodeStart = currentIndex;
        const nodeEnd = currentIndex + node.textContent.length;

        if (nodeEnd <= startIndex || nodeStart >= endIndex) {
            currentIndex = nodeEnd;
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
            span.setAttribute('data-hl-id', hlId);
            span.setAttribute('data-color', color);
            span.style.backgroundColor = bgColor;
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
            span.setAttribute('data-hl-id', hlId);
            span.setAttribute('data-color', color);
            span.style.backgroundColor = bgColor;
            span.textContent = node.textContent;

            node.parentNode.replaceChild(span, node);
        }

        currentIndex = nodeEnd;
    });
}

function onCharacterChange() {
    // 형광펜 모드가 활성화되어 있으면 비활성화 후 대기
    if (isHighlightMode) {
        disableHighlightMode();
    }

    // DOM 업데이트 대기 후 하이라이트 복원 및 형광펜 모드 재활성화
    setTimeout(() => {
        // 캐릭터 변경 시 이전 상태 업데이트
        previousCharId = this_chid;
        previousChatFile = getCurrentChatFile();
        previousChatLength = chat ? chat.length : 0;

        restoreHighlightsInChat();

        if (isHighlightMode) {
            enableHighlightMode();
        }
    }, 500);
}

function onChatChange() {
    // 형광펜 모드가 활성화되어 있으면 비활성화 후 대기
    if (isHighlightMode) {
        disableHighlightMode();
    }

    // DOM 업데이트 대기 후 하이라이트 복원 및 형광펜 모드 재활성화
    setTimeout(() => {
        // 채팅 제목 변경 감지 및 데이터 동기화
        const currentCharId = this_chid;
        const currentChatFile = getCurrentChatFile();
        const currentChatLength = chat ? chat.length : 0;

        // 같은 캐릭터, 같은 메시지 개수, 다른 파일 이름 = 제목만 변경 OR 체크포인트/분기
        const isChatRenamed =
            previousCharId !== null &&
            currentCharId === previousCharId &&
            previousChatFile !== null &&
            currentChatFile !== null &&
            previousChatFile !== currentChatFile &&
            previousChatLength !== null &&
            currentChatLength === previousChatLength &&
            currentChatLength > 0; // 빈 채팅이 아닌 경우만

        if (isChatRenamed) {
            // ⭐⭐ 체크포인트/분기와 실제 제목 변경 구별
            // 파일명에 Branch, Checkpoint 등이 포함되어 있으면 분기/체크포인트로 판단
            const checkpointKeywords = ['branch', 'checkpoint', 'fork', 'split'];
            const isCheckpointOrBranch = checkpointKeywords.some(keyword =>
                currentChatFile.toLowerCase().includes(keyword) &&
                !previousChatFile.toLowerCase().includes(keyword)
            );

            if (isCheckpointOrBranch) {
                // 체크포인트/분기 생성 - 데이터 이동하지 않음 (자동 복사가 처리함)
                console.log(`[SillyTavern-Highlighter] Checkpoint/branch creation detected: "${previousChatFile}" -> "${currentChatFile}"`);
                console.log(`[SillyTavern-Highlighter] Highlights will be auto-copied by restoreHighlightsInChat()`);
            } else {
                // 실제 채팅 제목 변경 - 데이터 이동
                // 이전 파일 이름의 하이라이트 데이터가 있는지 확인
                if (settings.highlights[currentCharId]?.[previousChatFile]) {
                    // 새 파일 이름에 데이터가 없는 경우에만 이동
                    if (!settings.highlights[currentCharId][currentChatFile]) {
                        console.log(`[SillyTavern-Highlighter] Chat renamed detected: "${previousChatFile}" -> "${currentChatFile}" (${currentChatLength} messages)`);

                        // 하이라이트 데이터를 새 키로 이동
                        settings.highlights[currentCharId][currentChatFile] = settings.highlights[currentCharId][previousChatFile];

                        // 이전 키 삭제
                        delete settings.highlights[currentCharId][previousChatFile];

                        // 저장
                        saveSettingsDebounced();

                        toastr.success('하이라이트가 변경된 채팅 제목과 동기화되었습니다');
                    }
                }
            }
        }

        // 현재 상태 저장
        previousCharId = currentCharId;
        previousChatFile = currentChatFile;
        previousChatLength = currentChatLength;

        restoreHighlightsInChat();

        if (isHighlightMode) {
            enableHighlightMode();
        }
    }, 500);
}


function onChatDeleted(chatFile) {
    const charId = this_chid;

    if (settings.deleteMode === 'delete') {
        if (settings.highlights[charId]?.[chatFile]) {
            delete settings.highlights[charId][chatFile];
            toastr.info('하이라이트 삭제됨');
            saveSettingsDebounced();
        }
    } else {
        toastr.info('하이라이트 보관됨');
    }
}

// Breadcrumb More 메뉴 표시
function showHighlightItemMoreMenu(e) {
    e.stopPropagation();

    const $existingMenu = $('#hl-item-more-menu');
    if ($existingMenu.length) {
        $existingMenu.remove();
        return;
    }

    const $btn = $(e.currentTarget);
    const mesId = $btn.data('mesId');
    const hlId = $btn.data('hlId');
    const rect = $btn[0].getBoundingClientRect();

    const menuHtml = `
        <div id="hl-item-more-menu" class="hl-more-menu ${getDarkModeClass()}" data-mes-id="${mesId}" data-hl-id="${hlId}">
            <button class="hl-more-menu-item" data-action="copy">
                <i class="fa-solid fa-copy"></i>
                <span>복사</span>
            </button>
            <button class="hl-more-menu-item" data-action="edit">
                <i class="fa-solid fa-pen"></i>
                <span>메모 수정</span>
            </button>
            <button class="hl-more-menu-item" data-action="delete">
                <i class="fa-solid fa-trash"></i>
                <span>삭제</span>
            </button>
        </div>
    `;

    $('body').append(menuHtml);

    const $newMenu = $('#hl-item-more-menu');
    const $panel = $('#highlighter-panel');
    const panelRect = $panel[0].getBoundingClientRect();

    // 메뉴 실제 크기 측정
    const menuRect = $newMenu[0].getBoundingClientRect();
    const menuWidth = menuRect.width;
    const menuHeight = menuRect.height;
    const margin = 10;

    // 기본 위치: 버튼 아래, 오른쪽 정렬
    let top = rect.bottom + 5;
    let left = rect.right - menuWidth;

    // 오른쪽으로 나가면 왼쪽으로
    if (left + menuWidth > panelRect.right - margin) {
        left = panelRect.right - menuWidth - margin;
    }
    // 왼쪽으로 나가면 오른쪽으로
    if (left < panelRect.left + margin) {
        left = panelRect.left + margin;
    }
    // 아래로 나가면 위로
    if (top + menuHeight > panelRect.bottom - margin) {
        top = rect.top - menuHeight - 5;
    }
    // 위로도 나가면 패널 상단에
    if (top < panelRect.top + margin) {
        top = panelRect.top + margin;
    }
    // 여전히 아래로 나가면 패널 하단에
    if (top + menuHeight > panelRect.bottom - margin) {
        top = panelRect.bottom - menuHeight - margin;
    }

    $newMenu.css({
        position: 'fixed',
        top: top + 'px',
        left: left + 'px',
        zIndex: 100002
    });

    // 이벤트 바인딩
    $newMenu.find('.hl-more-menu-item').off('click').on('click', function (e) {
        e.stopPropagation();
        const action = $(this).data('action');
        const menuMesId = $newMenu.data('mesId');
        const menuHlId = $newMenu.data('hlId');

        switch (action) {
            case 'copy':
                showCopyModal(menuHlId);
                break;
            case 'edit':
                showNoteModal(menuHlId);
                break;
            case 'delete':
                deleteHighlight(menuHlId);
                break;
        }

        $newMenu.remove();
    });

    // 외부 클릭 시 닫기
    setTimeout(() => {
        $(document).one('click', () => $('#hl-item-more-menu').remove());
    }, 100);
}

function showBreadcrumbMoreMenu(e) {
    e.stopPropagation();

    const $existingMenu = $('#hl-breadcrumb-more-menu');
    if ($existingMenu.length) {
        $existingMenu.remove();
        return;
    }

    const $btn = $(e.currentTarget);
    const rect = $btn[0].getBoundingClientRect();

    let menuHtml = '';

    if (selectedChat) {
        // 하이라이트 목록 뷰
        menuHtml = `
            <div id="hl-breadcrumb-more-menu" class="hl-more-menu ${getDarkModeClass()}">
                <button class="hl-more-menu-item" data-action="delete-chat">
                    <i class="fa-solid fa-trash"></i>
                    <span>이 채팅의 모든 하이라이트 삭제</span>
                </button>
            </div>
        `;
    } else if (selectedCharacter) {
        // 채팅 목록 뷰
        menuHtml = `
            <div id="hl-breadcrumb-more-menu" class="hl-more-menu ${getDarkModeClass()}">
                <button class="hl-more-menu-item" data-action="delete-character">
                    <i class="fa-solid fa-trash"></i>
                    <span>이 캐릭터의 모든 하이라이트 삭제</span>
                </button>
            </div>
        `;
    }

    $('body').append(menuHtml);

    const $breadcrumbMenu = $('#hl-breadcrumb-more-menu');
    const $panel = $('#highlighter-panel');
    const panelRect = $panel[0].getBoundingClientRect();

    // 메뉴 실제 크기 측정
    const menuRect = $breadcrumbMenu[0].getBoundingClientRect();
    const menuWidth = menuRect.width;
    const menuHeight = menuRect.height;
    const margin = 10;

    // 기본 위치: 버튼 아래, 오른쪽 정렬
    let top = rect.bottom + 5;
    let left = rect.right - menuWidth;

    // 오른쪽으로 나가면 왼쪽으로
    if (left + menuWidth > panelRect.right - margin) {
        left = panelRect.right - menuWidth - margin;
    }
    // 왼쪽으로 나가면 오른쪽으로
    if (left < panelRect.left + margin) {
        left = panelRect.left + margin;
    }
    // 아래로 나가면 위로
    if (top + menuHeight > panelRect.bottom - margin) {
        top = rect.top - menuHeight - 5;
    }
    // 위로도 나가면 패널 상단에
    if (top < panelRect.top + margin) {
        top = panelRect.top + margin;
    }
    // 여전히 아래로 나가면 패널 하단에
    if (top + menuHeight > panelRect.bottom - margin) {
        top = panelRect.bottom - menuHeight - margin;
    }

    $breadcrumbMenu.css({
        position: 'fixed',
        top: top + 'px',
        left: left + 'px',
        zIndex: 100002
    });

    // 이벤트 바인딩
    $('[data-action="delete-chat"]').on('click', function() {
        $('#hl-breadcrumb-more-menu').remove();
        deleteChatHighlights();
    });

    $('[data-action="delete-character"]').on('click', function() {
        $('#hl-breadcrumb-more-menu').remove();
        deleteCharacterHighlights();
    });

    // 외부 클릭 시 닫기
    setTimeout(() => {
        $(document).one('click', () => $('#hl-breadcrumb-more-menu').remove());
    }, 100);
}

// Header More 메뉴 표시
function showHeaderMoreMenu(e) {
    e.stopPropagation();

    const $existingMenu = $('#hl-header-more-menu');
    if ($existingMenu.length) {
        $existingMenu.remove();
        return;
    }

    const $btn = $(e.currentTarget);
    const rect = $btn[0].getBoundingClientRect();

    const menuHtml = `
        <div id="hl-header-more-menu" class="hl-more-menu ${getDarkModeClass()}">
            <button class="hl-more-menu-item" data-action="export">
                <i class="fa-solid fa-download"></i>
                <span>백업</span>
            </button>
            <button class="hl-more-menu-item" data-action="import">
                <i class="fa-solid fa-upload"></i>
                <span>불러오기</span>
            </button>
        </div>
    `;

    $('body').append(menuHtml);

    const $headerMenu = $('#hl-header-more-menu');
    const $panel = $('#highlighter-panel');
    const panelRect = $panel[0].getBoundingClientRect();

    // 메뉴 실제 크기 측정
    const menuRect = $headerMenu[0].getBoundingClientRect();
    const menuWidth = menuRect.width;
    const menuHeight = menuRect.height;
    const margin = 10;

    // 기본 위치: 버튼 아래, 오른쪽 정렬
    let top = rect.bottom + 5;
    let left = rect.right - menuWidth;

    // 오른쪽으로 나가면 왼쪽으로
    if (left + menuWidth > panelRect.right - margin) {
        left = panelRect.right - menuWidth - margin;
    }
    // 왼쪽으로 나가면 오른쪽으로
    if (left < panelRect.left + margin) {
        left = panelRect.left + margin;
    }
    // 아래로 나가면 위로
    if (top + menuHeight > panelRect.bottom - margin) {
        top = rect.top - menuHeight - 5;
    }
    // 위로도 나가면 패널 상단에
    if (top < panelRect.top + margin) {
        top = panelRect.top + margin;
    }
    // 여전히 아래로 나가면 패널 하단에
    if (top + menuHeight > panelRect.bottom - margin) {
        top = panelRect.bottom - menuHeight - margin;
    }

    $headerMenu.css({
        position: 'fixed',
        top: top + 'px',
        left: left + 'px',
        zIndex: 100002
    });

    // 이벤트 바인딩
    $('[data-action="export"]').on('click', function() {
        $('#hl-header-more-menu').remove();
        exportHighlights();
    });

    $('[data-action="import"]').on('click', function() {
        $('#hl-header-more-menu').remove();
        $('#hl-import-file-input').click();
    });

    // 외부 클릭 시 닫기
    setTimeout(() => {
        $(document).one('click', () => $('#hl-header-more-menu').remove());
    }, 100);
}

// 과거 메시지 로딩 감지를 위한 MutationObserver 설정
function setupChatObserver() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) {
        console.warn('[SillyTavern-Highlighter] Chat container not found, retrying...');
        setTimeout(setupChatObserver, 1000);
        return;
    }

    const observer = new MutationObserver((mutations) => {
        let shouldRestore = false;

        mutations.forEach((mutation) => {
            // 새로운 메시지가 추가되었는지 확인
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach((node) => {
                    if (node.classList && node.classList.contains('mes')) {
                        shouldRestore = true;
                    }
                });
            }
        });

        // 새 메시지가 추가되면 하이라이트 복원
        if (shouldRestore) {
            setTimeout(() => {
                restoreHighlightsInChat();
            }, 300);
        }
    });

    observer.observe(chatContainer, {
        childList: true,
        subtree: true
    });

    console.log('[SillyTavern-Highlighter] Chat observer set up');
}

// ====================================
// 업데이트 체크 기능
// ====================================

// 버전 비교 함수 (semantic versioning)
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;

        if (p1 > p2) return 1;  // v1이 더 최신
        if (p1 < p2) return -1; // v2가 더 최신
    }

    return 0; // 같음
}

// GitHub에서 최신 버전 확인
async function checkForUpdates() {
    try {
        // 캐시 확인 (24시간마다만 체크)
        const cached = localStorage.getItem(UPDATE_CHECK_CACHE_KEY);
        if (cached) {
            const cacheData = JSON.parse(cached);
            const now = Date.now();

            if (now - cacheData.timestamp < UPDATE_CHECK_INTERVAL) {
                console.log('[SillyTavern-Highlighter] Using cached update check');
                return cacheData.hasUpdate ? cacheData.latestVersion : null;
            }
        }

        console.log('[SillyTavern-Highlighter] Checking for updates...');

        // GitHub raw URL로 manifest.json 가져오기
        // master와 main 둘 다 시도
        const timestamp = Date.now(); // 캐시 무효화용 타임스탬프
        const urls = [
            `https://raw.githubusercontent.com/${GITHUB_REPO}/main/manifest.json?t=${timestamp}`,
            `https://raw.githubusercontent.com/${GITHUB_REPO}/master/manifest.json?t=${timestamp}`
        ];

        let remoteManifest = null;

        for (const url of urls) {
            try {
                // 쿼리 파라미터로 캐시 우회하므로 헤더는 최소화 (CORS 오류 방지)
                const response = await fetch(url, {
                    cache: 'no-store'
                });

                if (response.ok) {
                    remoteManifest = await response.json();
                    break; // 성공하면 중단
                }
            } catch (err) {
                console.warn(`[SillyTavern-Highlighter] Failed to fetch from ${url}:`, err);
            }
        }

        if (!remoteManifest || !remoteManifest.version) {
            console.warn('[SillyTavern-Highlighter] Could not fetch remote version');
            return null;
        }

        const latestVersion = remoteManifest.version;
        const currentVersion = EXTENSION_VERSION;

        console.log(`[SillyTavern-Highlighter] Current: ${currentVersion}, Latest: ${latestVersion}`);

        const comparison = compareVersions(latestVersion, currentVersion);
        const hasUpdate = comparison > 0;

        // 캐시 저장
        localStorage.setItem(UPDATE_CHECK_CACHE_KEY, JSON.stringify({
            timestamp: Date.now(),
            latestVersion: latestVersion,
            hasUpdate: hasUpdate
        }));

        if (hasUpdate) {
            console.log(`[SillyTavern-Highlighter] ✨ Update available: ${latestVersion}`);
            return latestVersion;
        } else {
            console.log('[SillyTavern-Highlighter] You are up to date!');
            return null;
        }

    } catch (error) {
        console.warn('[SillyTavern-Highlighter] Update check failed:', error);
        return null; // 오류 시 조용히 실패
    }
}

// 업데이트 알림 표시
function showUpdateNotification(latestVersion) {
    try {
        // settings.html의 헤더 찾기
        const $header = $('.highlighter-settings .inline-drawer-header b');

        if ($header.length) {
            // 이미 UPDATE 표시가 있으면 중복 방지
            if ($header.find('.hl-update-badge').length > 0) return;

            // UPDATE 배지 추가 (클릭 불가, 표시만)
            const badge = `<span class="hl-update-badge" style="
                display: inline-block;
                margin-left: 8px;
                padding: 2px 8px;
                background: linear-gradient(135deg, #ff6b6b, #ee5a6f);
                color: white;
                font-size: 11px;
                font-weight: 700;
                border-radius: 4px;
                animation: pulse 2s ease-in-out infinite;
                box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
                vertical-align: middle;
            " title="새 버전 ${latestVersion} 사용 가능">UPDATE!</span>`;

            $header.append(badge);

            // CSS 애니메이션 추가
            if (!$('#hl-update-animation').length) {
                $('<style id="hl-update-animation">@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.05); } }</style>').appendTo('head');
            }

            console.log('[SillyTavern-Highlighter] Update notification displayed');

            // 사용자에게 토스트 알림
            toastr.info(`새 버전 ${latestVersion}이(가) 출시되었습니다!<br>설정 페이지에서 확인하세요.`, '형광펜 업데이트', {
                timeOut: 10000,
                extendedTimeOut: 5000,
                escapeHtml: false
            });
        }
    } catch (error) {
        console.warn('[SillyTavern-Highlighter] Failed to show update notification:', error);
    }
}

(async function () {
    console.log('[SillyTavern-Highlighter] Loading...');

    const extensionFolderPath = await getExtensionFolderPath();

    // ⭐ manifest.json에서 버전 로드
    try {
        const manifestResponse = await fetch(`${extensionFolderPath}/manifest.json`);
        if (manifestResponse.ok) {
            const manifest = await manifestResponse.json();
            if (manifest.version) {
                EXTENSION_VERSION = manifest.version;
                console.log(`[SillyTavern-Highlighter] Version loaded from manifest: ${EXTENSION_VERSION}`);
            }
        }
    } catch (error) {
        console.warn('[SillyTavern-Highlighter] Could not load manifest.json, using default version');
    }

    // 설정 로드 및 초기화
    let loadedSettings = extension_settings[extensionName];

    if (!loadedSettings) {
        // 최초 실행: 기본 설정 사용
        console.log('[SillyTavern-Highlighter] First run, initializing with defaults');
        settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    } else {
        // 기존 데이터 존재: 검증 → 마이그레이션
        console.log('[SillyTavern-Highlighter] Loading existing data');
        settings = validateAndRepairSettings(loadedSettings);
        settings = migrateSettings(settings);
    }

    // extension_settings에 반영
    extension_settings[extensionName] = settings;

    // 마이그레이션이 발생했으면 저장 (버전 필드 업데이트)
    if (!loadedSettings || loadedSettings.version !== EXTENSION_VERSION) {
        console.log('[SillyTavern-Highlighter] Saving migrated data');
        saveSettingsDebounced();
    }

    createHighlighterUI();

    // 요술봉 메뉴에 버튼 추가
    addToWandMenu();

    try {
        const html = await $.get(`${extensionFolderPath}/settings.html`);
        $('#extensions_settings2').append(html);

        $('#hl_setting_delete_mode').val(settings.deleteMode).on('change', function () {
            settings.deleteMode = $(this).val();
            saveSettingsDebounced();
        });

        $('#hl_setting_button_position').val(settings.buttonPosition).on('change', function () {
            settings.buttonPosition = $(this).val();
            applyButtonPosition();
            saveSettingsDebounced();
        });

        $('#hl_setting_show_floating_btn').prop('checked', settings.showFloatingBtn !== false).on('change', function () {
            settings.showFloatingBtn = $(this).is(':checked');
            applyButtonPosition();
            saveSettingsDebounced();
        });

        $('#hl_setting_always_highlight_mode').prop('checked', settings.alwaysHighlightMode || false).on('change', function () {
            settings.alwaysHighlightMode = $(this).is(':checked');

            // 항상 활성화를 체크하면 즉시 형광펜 모드 활성화
            if (settings.alwaysHighlightMode && !isHighlightMode) {
                isHighlightMode = true;
                $('#hl-floating-highlight-mode-btn').addClass('active');
                enableHighlightMode();
                toastr.info('형광펜 모드 활성화');

                // 요술봉 메뉴 상태 업데이트
                const $status = $('#highlighter_mode_status');
                if ($status.length) {
                    $status.text('(켜짐)');
                }
            }

            saveSettingsDebounced();
        });

        // 색상 커스터마이저 초기화
        initColorCustomizer();

        $('#hl-reset-colors').on('click', resetColors);
        $('#hl-export-colors').on('click', exportColors);
        $('#hl-import-colors').on('click', () => $('#hl-color-import-input').click());
        $('#hl-color-import-input').on('change', importColors);

        // 업데이트 확인 버튼
        $('#hl-check-update-btn').on('click', async function() {
            const $btn = $(this);
            const $status = $('#hl-update-status');

            // 버튼 비활성화 및 로딩 표시
            $btn.prop('disabled', true);
            $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> 확인 중...');
            $status.hide();

            try {
                // 캐시 강제 무시
                localStorage.removeItem(UPDATE_CHECK_CACHE_KEY);

                const latestVersion = await checkForUpdates();

                if (latestVersion) {
                    // 업데이트 있음
                    $status.css({
                        'background': 'rgba(255, 107, 107, 0.1)',
                        'border': '1px solid rgba(255, 107, 107, 0.3)',
                        'color': '#ff6b6b'
                    }).html(`
                        <i class="fa-solid fa-circle-exclamation"></i>
                        <strong>새 버전 ${latestVersion}이(가) 출시되었습니다!</strong><br>
                        <span style="font-size: 12px;">확장 프로그램 관리에서 업데이트할 수 있습니다.</span>
                    `).show();

                    // 헤더에 UPDATE! 배지 표시
                    showUpdateNotification(latestVersion);
                } else {
                    // 최신 버전
                    $status.css({
                        'background': 'rgba(76, 175, 80, 0.1)',
                        'border': '1px solid rgba(76, 175, 80, 0.3)',
                        'color': '#4caf50'
                    }).html(`
                        <i class="fa-solid fa-circle-check"></i>
                        <strong>최신 버전을 사용 중입니다!</strong> (v${EXTENSION_VERSION})
                    `).show();
                }
            } catch (error) {
                console.error('[SillyTavern-Highlighter] Update check failed:', error);
                $status.css({
                    'background': 'rgba(255, 152, 0, 0.1)',
                    'border': '1px solid rgba(255, 152, 0, 0.3)',
                    'color': '#ff9800'
                }).html(`
                    <i class="fa-solid fa-circle-xmark"></i>
                    <strong>업데이트 확인 실패</strong><br>
                    <span style="font-size: 12px;">네트워크 연결을 확인해주세요.</span>
                `).show();
            } finally {
                // 버튼 복원
                $btn.prop('disabled', false);
                $btn.html('<i class="fa-solid fa-sync"></i> 업데이트 확인');
            }
        });

    } catch (error) {
        console.warn('[SillyTavern-Highlighter] Settings HTML load failed:', error);
    }

    eventSource.on(event_types.CHARACTER_SELECTED, onCharacterChange);
    eventSource.on(event_types.CHAT_CHANGED, onChatChange);
    eventSource.on(event_types.MESSAGE_RECEIVED, restoreHighlightsInChat);
    eventSource.on(event_types.MESSAGE_SENT, restoreHighlightsInChat);
    eventSource.on(event_types.MESSAGE_UPDATED, restoreHighlightsInChat);
    eventSource.on(event_types.MESSAGE_SWIPED, restoreHighlightsInChat);

    // 과거 메시지 로딩 감지를 위한 MutationObserver 설정
    setupChatObserver();

    // 동적 색상 스타일 적용
    updateDynamicColorStyles();

    // 초기 상태 저장 (채팅 제목 변경 감지를 위해)
    previousCharId = this_chid;
    previousChatFile = getCurrentChatFile();
    previousChatLength = chat ? chat.length : 0;

    restoreHighlightsInChat();

    // 항상 활성화 모드가 켜져 있으면 초기화 시 자동 활성화
    if (settings.alwaysHighlightMode) {
        setTimeout(() => {
            isHighlightMode = true;
            $('#hl-floating-highlight-mode-btn').addClass('active');
            enableHighlightMode();

            // 요술봉 메뉴 상태 업데이트
            const $status = $('#highlighter_mode_status');
            if ($status.length) {
                $status.text('(켜짐)');
            }

            console.log('[SillyTavern-Highlighter] Auto-enabled highlight mode (always on setting)');
        }, 500); // DOM이 준비될 때까지 약간의 딜레이
    }

    console.log('[SillyTavern-Highlighter] Loaded');

    // ⭐ 업데이트 체크 (비동기, 백그라운드 실행)
    setTimeout(async () => {
        try {
            const latestVersion = await checkForUpdates();
            if (latestVersion) {
                showUpdateNotification(latestVersion);
            }
        } catch (error) {
            console.warn('[SillyTavern-Highlighter] Update check failed silently:', error);
        }
    }, 2000); // 2초 후 실행 (다른 초기화 완료 후)
})();
