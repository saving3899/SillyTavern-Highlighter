// ====================================
// 상수 및 기본값 정의
// ====================================

export const extensionName = 'SillyTavern-Highlighter';

export const EXT_PATHS = [
    `scripts/extensions/third-party/${extensionName}`,
    `../../../data/default-user/extensions/${extensionName}`,
];

export const VIEW_LEVELS = {
    CHARACTER_LIST: 'character_list',
    CHAT_LIST: 'chat_list',
    HIGHLIGHT_LIST: 'highlight_list'
};

// 밝은 파스텔 톤 기본 색상
export const DEFAULT_COLORS = [
    { bg: '#FFE4B5', opacity: 0.8, textColor: '#222', useDefaultTextColor: false },
    { bg: '#D4F1D4', opacity: 0.8, textColor: '#222', useDefaultTextColor: false },
    { bg: '#E6D5F0', opacity: 0.8, textColor: '#222', useDefaultTextColor: false },
    { bg: '#C7EBFF', opacity: 0.8, textColor: '#222', useDefaultTextColor: false },
    { bg: '#FFD4E5', opacity: 0.8, textColor: '#222', useDefaultTextColor: false }
];

// 기본 프리셋 (색상 고정, 불투명도만 커스터마이징 가능)
export const DEFAULT_PRESET = {
    name: '기본',
    isDefault: true,
    colors: JSON.parse(JSON.stringify(DEFAULT_COLORS))
};

// 빈 유저 프리셋 생성 함수
export function createEmptyPreset(index) {
    return {
        name: `프리셋 ${index}`,
        isDefault: false,
        colors: JSON.parse(JSON.stringify(DEFAULT_COLORS))
    };
}

export const GITHUB_REPO = 'saving3899/SillyTavern-Highlighter';
export const UPDATE_CHECK_CACHE_KEY = 'highlighter_update_check';
export const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24시간 (밀리초)

export const DEFAULT_SETTINGS = {
    version: '1.0.0',
    enabled: true,
    deleteMode: 'keep',
    darkMode: false,
    buttonPosition: 'bottom-right',
    showFloatingBtn: true,
    floatingBtnSize: 'medium',
    floatingBtnColor: '#333333',
    floatingBtnIconColor: '#ffffff',
    floatingBtnIcon: 'fa-bars',
    showWandButton: true,
    alwaysHighlightMode: false,
    panelPosition: null,
    bookmarkButtonPosition: 'extraMesButtons',
    highlights: {},
    bookmarks: {},
    characterMemos: {},
    chatMemos: {},
    customColors: null,
    colorPresets: null,
    currentPresetIndex: 0,
    sortOptions: {
        chats: 'modified',
        highlights: 'created',
        directions: {
            characters: 'desc',
            chats: 'desc',
            highlights: 'desc'
        }
    },
    showTabCounts: true,
    characterNames: {},
    translatorCompat: false,
    translatorPanelDisplay: 'translated',
    translatorShowAltText: true,
    translatorSyncHighlight: true
};
