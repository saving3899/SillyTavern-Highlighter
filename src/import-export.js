// import-export.js — 형광펜 데이터 및 설정 내보내기/불러오기
// 백업 모달, JSON/TXT 내보내기, 불러오기, 설정 내보내기/불러오기

import { saveSettingsDebounced } from '../../../../../script.js';
import { state } from './state.js';
import { deepMerge } from './utils.js';
import { getCharacterNameByKey } from './character-keys.js';
import { validateAndRepairSettings } from './data.js';
import { restoreHighlightsInChat } from './highlight-dom.js';
import { initColorCustomizer } from './color.js';
import { getDarkModeClass, applyButtonPosition, updateWandMenuVisibility } from './ui-panel.js';
import { renderView } from './ui-render.js';

// ====================================
// 백업 모달
// ====================================

export function showBackupModal() {
    $('#highlight-backup-modal').remove();

    const modal = `
        <div id="highlight-backup-modal" class="hl-modal-overlay">
            <div class="hl-modal ${getDarkModeClass()}">
                <div class="hl-modal-header">
                    <h3>형광펜 백업</h3>
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
                            <input type="radio" name="backup-scope" value="character" ${!state.selectedCharacter ? 'disabled' : ''} style="margin-right: 8px;">
                            현재 캐릭터만 ${!state.selectedCharacter ? '(선택된 캐릭터 없음)' : ''}
                        </label>
                        <label class="hl-modal-label-option">
                            <input type="radio" name="backup-scope" value="chat" ${!state.selectedChat ? 'disabled' : ''} style="margin-right: 8px;">
                            현재 채팅만 ${!state.selectedChat ? '(선택된 채팅 없음)' : ''}
                        </label>
                    </div>
                    <div id="hl-backup-translator-option" style="display: none; margin-top: 20px;">
                        <label class="hl-modal-label-title">번역 형광펜 표시:</label>
                        <label class="hl-modal-label-option">
                            <input type="radio" name="backup-translator" value="both" checked style="margin-right: 8px;">
                            번역문과 원문
                        </label>
                        <label class="hl-modal-label-option">
                            <input type="radio" name="backup-translator" value="translated" style="margin-right: 8px;">
                            번역문만
                        </label>
                        <label class="hl-modal-label-option">
                            <input type="radio" name="backup-translator" value="original" style="margin-right: 8px;">
                            원문만
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

    // TXT 선택 시 번역 옵션 표시/숨김
    const updateTranslatorOption = () => {
        const format = $('input[name="backup-format"]:checked').val();
        const scope = $('input[name="backup-scope"]:checked').val();
        if (format === 'txt' && hasTranslatorHighlights(scope)) {
            $('#hl-backup-translator-option').show();
        } else {
            $('#hl-backup-translator-option').hide();
        }
    };
    $('input[name="backup-format"], input[name="backup-scope"]').on('change', updateTranslatorOption);

    $('.hl-modal-save').on('click', function () {
        const format = $('input[name="backup-format"]:checked').val();
        const scope = $('input[name="backup-scope"]:checked').val();

        if (format === 'json') {
            exportHighlightsJSON(scope);
        } else {
            const translatorMode = $('input[name="backup-translator"]:checked').val() || 'both';
            exportHighlightsTXT(scope, translatorMode);
        }

        $('#highlight-backup-modal').remove();
    });

    $('.hl-modal-close, .hl-modal-cancel').on('click', function () {
        $('#highlight-backup-modal').remove();
    });

    $('.hl-modal-overlay').on('click', function (e) {
        if (e.target === this) $(this).remove();
    });
}

// ====================================
// JSON 내보내기
// ====================================

function exportHighlightsJSON(scope) {
    let dataToExport = {};
    let scopeName = '전체';

    if (scope === 'all') {
        dataToExport = state.settings.highlights;
        scopeName = '전체';
    } else if (scope === 'character' && state.selectedCharacter) {
        dataToExport[state.selectedCharacter] = state.settings.highlights[state.selectedCharacter];
        scopeName = getCharacterNameByKey(state.selectedCharacter);
    } else if (scope === 'chat' && state.selectedCharacter && state.selectedChat) {
        dataToExport[state.selectedCharacter] = {
            [state.selectedChat]: state.settings.highlights[state.selectedCharacter]?.[state.selectedChat]
        };
        scopeName = `${getCharacterNameByKey(state.selectedCharacter)}_${state.selectedChat}`;
    }

    const data = {
        version: '1.0.0',
        exportDate: Date.now(),
        scope: scope,
        highlights: dataToExport,
        // ⭐ 컨텐츠 백업에는 메모와 이름 캐시만 포함 (설정 제외)
        characterMemos: scope === 'all' ? state.settings.characterMemos : undefined,
        chatMemos: scope === 'all' ? state.settings.chatMemos : undefined,
        characterNames: scope === 'all' ? state.settings.characterNames : undefined
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

// ====================================
// TXT 내보내기
// ====================================

/**
 * 지정 범위 내 번역 데이터가 포함된 형광펜이 있는지 확인
 */
function hasTranslatorHighlights(scope) {
    const data = getDataForScope(scope);
    for (const charId of Object.keys(data)) {
        const chatData = data[charId];
        if (!chatData) continue;
        for (const chatFile of Object.keys(chatData)) {
            const highlights = chatData[chatFile]?.highlights || [];
            if (highlights.some(hl => hl.sourceType && (hl.translatedText || hl.translatorOriginalText))) {
                return true;
            }
        }
    }
    return false;
}

/**
 * scope에 따라 내보낼 데이터 객체 반환
 */
function getDataForScope(scope) {
    if (scope === 'character' && state.selectedCharacter) {
        return { [state.selectedCharacter]: state.settings.highlights[state.selectedCharacter] };
    }
    if (scope === 'chat' && state.selectedCharacter && state.selectedChat) {
        return {
            [state.selectedCharacter]: {
                [state.selectedChat]: state.settings.highlights[state.selectedCharacter]?.[state.selectedChat]
            }
        };
    }
    return state.settings.highlights;
}

/**
 * 번역 옵션에 따라 형광펜의 출력 텍스트를 결정
 */
function getHighlightTextForExport(hl, translatorMode) {
    // 번역 데이터가 없는 형광펜은 그대로 출력
    if (!hl.sourceType || (!hl.translatedText && !hl.translatorOriginalText)) {
        return hl.text;
    }

    // sourceType에 따라 번역문/원문 판별
    const translated = hl.sourceType === 'translated' ? hl.text : hl.translatedText;
    const original = hl.sourceType === 'original' ? hl.text : hl.translatorOriginalText;

    if (translatorMode === 'translated') {
        return translated || hl.text;
    }
    if (translatorMode === 'original') {
        return original || hl.text;
    }
    // 'both' — 둘 다 출력
    const parts = [];
    if (translated) parts.push(`[번역문] ${translated}`);
    if (original) parts.push(`[원문] ${original}`);
    return parts.length > 0 ? parts.join('\n') : hl.text;
}

function exportHighlightsTXT(scope, translatorMode) {
    let content = '';
    const now = new Date();
    const dateStr = now.toLocaleString('ko-KR');

    let scopeName = '전체';
    let totalHighlights = 0;
    let totalCharacters = 0;
    let totalChats = 0;

    // 헤더
    content += '===========================================\n';
    content += '독서노트 형광펜 모음\n';
    content += `생성일: ${dateStr}\n`;

    // 데이터 수집
    let dataToExport = {};

    if (scope === 'all') {
        dataToExport = state.settings.highlights;
        scopeName = '전체';
    } else if (scope === 'character' && state.selectedCharacter) {
        dataToExport[state.selectedCharacter] = state.settings.highlights[state.selectedCharacter];
        scopeName = getCharacterNameByKey(state.selectedCharacter);
    } else if (scope === 'chat' && state.selectedCharacter && state.selectedChat) {
        dataToExport[state.selectedCharacter] = {
            [state.selectedChat]: state.settings.highlights[state.selectedCharacter]?.[state.selectedChat]
        };
        scopeName = `${getCharacterNameByKey(state.selectedCharacter)} > ${state.selectedChat}`;
    }

    content += `범위: ${scopeName}\n`;
    content += '===========================================\n\n';

    // 하이라이트 내용
    let charIds = Object.keys(dataToExport);

    // 캐릭터 정렬
    const charSortOption = state.settings.sortOptions?.characters || 'modified';
    if (charSortOption === 'name') {
        charIds.sort((a, b) => {
            const nameA = getCharacterNameByKey(a);
            const nameB = getCharacterNameByKey(b);
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
        const charName = getCharacterNameByKey(charId);
        const chatData = dataToExport[charId];

        if (!chatData) return;

        let charHasHighlights = false; // 캐릭터에 형광펜이 있는지 체크

        let chatFiles = Object.keys(chatData);

        // 채팅 정렬
        const chatSortOption = state.settings.sortOptions?.chats || 'modified';
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

            if (!charHasHighlights) {
                charHasHighlights = true;
                totalCharacters++; // 이 캐릭터의 첫 형광펜 발견 시 카운트
            }

            totalChats++;

            // 하이라이트 정렬
            const hlSortOption = state.settings.sortOptions?.highlights || 'created';
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

                // 번역 형광펜 텍스트 출력
                const hlText = getHighlightTextForExport(hl, translatorMode);
                content += `${hlText}\n`;

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
    content += `총 형광펜: ${totalHighlights}개\n`;
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

// ====================================
// 데이터 내보내기/불러오기
// ====================================

// 기존 함수 호환성을 위해 유지
export function exportHighlights() {
    showBackupModal();
}

export function importHighlights(file) {
    const reader = new FileReader();

    reader.onerror = () => toastr.error('파일을 읽을 수 없습니다');

    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.version || !data.highlights) {
                throw new Error('잘못된 파일');
            }

            if (confirm('기존 데이터와 병합하시겠습니까?\n취소를 누르면 덮어씁니다.')) {
                // 1. 형광펜 데이터 병합
                state.settings.highlights = deepMerge(state.settings.highlights, data.highlights);

                // 2. 기타 컨텐츠 데이터 병합
                if (data.characterMemos) state.settings.characterMemos = Object.assign({}, state.settings.characterMemos, data.characterMemos);
                if (data.chatMemos) state.settings.chatMemos = Object.assign({}, state.settings.chatMemos, data.chatMemos);
                if (data.characterNames) state.settings.characterNames = Object.assign({}, state.settings.characterNames, data.characterNames);
                // 설정값은 여기서 처리하지 않음

            } else {
                // 덮어쓰기 모드
                state.settings.highlights = data.highlights;

                // 기타 컨텐츠 데이터도 덮어쓰기 (파일에 있는 경우만)
                if (data.characterMemos) state.settings.characterMemos = data.characterMemos;
                if (data.chatMemos) state.settings.chatMemos = data.chatMemos;
                if (data.characterNames) state.settings.characterNames = data.characterNames;
                // 설정값은 여기서 처리하지 않음
            }

            // 데이터 검증 및 초기화
            state.settings = validateAndRepairSettings(state.settings);

            saveSettingsDebounced();
            renderView();

            // 채팅 내 하이라이트 복원
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

// ====================================
// 설정 내보내기/불러오기
// ====================================

// ⭐ 환경설정 및 프리셋 내보내기 (Setting Panel용)
export function exportConfiguration() {
    const configData = {
        version: '1.0.0',
        exportDate: Date.now(),
        type: 'configuration', // 식별자
        colorPresets: state.settings.colorPresets,
        customColors: state.settings.customColors,
        generalSettings: {
            deleteMode: state.settings.deleteMode,
            darkMode: state.settings.darkMode,
            buttonPosition: state.settings.buttonPosition,
            showFloatingBtn: state.settings.showFloatingBtn,
            showWandButton: state.settings.showWandButton,
            alwaysHighlightMode: state.settings.alwaysHighlightMode,
            bookmarkButtonPosition: state.settings.bookmarkButtonPosition,
            sortOptions: state.settings.sortOptions,
            translatorCompat: state.settings.translatorCompat,
            translatorPanelDisplay: state.settings.translatorPanelDisplay,
            translatorShowAltText: state.settings.translatorShowAltText,
            translatorSyncHighlight: state.settings.translatorSyncHighlight
        }
    };

    const blob = new Blob([JSON.stringify(configData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const a = document.createElement('a');
    a.href = url;
    a.download = `highlighter_config_${timestamp}.json`;
    a.click();

    URL.revokeObjectURL(url);
    toastr.success('설정 백업 완료');
}

// ⭐ 환경설정 및 프리셋 불러오기 (Setting Panel용)
export function importConfiguration(file) {
    const reader = new FileReader();

    reader.onerror = () => toastr.error('파일을 읽을 수 없습니다');

    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);

            // 파일 유효성 검사
            if (!data.version || (!data.colorPresets && !data.generalSettings)) {
                throw new Error('올바른 설정 파일이 아닙니다');
            }

            if (confirm('현재 설정을 이 파일 내용으로 교체하시겠습니까?')) {
                // 1. 색상 설정 복원
                if (data.colorPresets) state.settings.colorPresets = data.colorPresets;
                if (data.customColors) state.settings.customColors = data.customColors;

                // 2. 일반 설정 복원
                if (data.generalSettings) {
                    const s = data.generalSettings;
                    if (s.deleteMode) state.settings.deleteMode = s.deleteMode;
                    if (s.darkMode !== undefined) state.settings.darkMode = s.darkMode;
                    if (s.buttonPosition) state.settings.buttonPosition = s.buttonPosition;
                    if (s.showFloatingBtn !== undefined) state.settings.showFloatingBtn = s.showFloatingBtn;
                    if (s.showWandButton !== undefined) state.settings.showWandButton = s.showWandButton;
                    if (s.alwaysHighlightMode !== undefined) state.settings.alwaysHighlightMode = s.alwaysHighlightMode;
                    if (s.bookmarkButtonPosition) state.settings.bookmarkButtonPosition = s.bookmarkButtonPosition;
                    if (s.sortOptions) state.settings.sortOptions = s.sortOptions;
                    if (s.translatorCompat !== undefined) state.settings.translatorCompat = s.translatorCompat;
                    if (s.translatorPanelDisplay) state.settings.translatorPanelDisplay = s.translatorPanelDisplay;
                    if (s.translatorShowAltText !== undefined) state.settings.translatorShowAltText = s.translatorShowAltText;
                    if (s.translatorSyncHighlight !== undefined) state.settings.translatorSyncHighlight = s.translatorSyncHighlight;
                }

                // UI 반영 (설정 패널 값 업데이트)
                $('#hl_setting_delete_mode').val(state.settings.deleteMode);
                $('#hl_setting_button_position').val(state.settings.buttonPosition);
                $('#hl_setting_show_floating_btn').prop('checked', state.settings.showFloatingBtn !== false);
                $('#hl_setting_show_wand_button').prop('checked', state.settings.showWandButton !== false);
                $('#hl_setting_always_highlight_mode').prop('checked', state.settings.alwaysHighlightMode || false);
                $('#hl_setting_bookmark_position').val(state.settings.bookmarkButtonPosition || 'extraMesButtons');
                $('#hl_setting_translator_compat').prop('checked', state.settings.translatorCompat || false).trigger('change');
                $('#hl_setting_translator_panel_display').val(state.settings.translatorPanelDisplay || 'translated');
                $('#hl_setting_translator_show_alt_text').prop('checked', state.settings.translatorShowAltText !== false);
                $('#hl_setting_translator_sync_highlight').prop('checked', state.settings.translatorSyncHighlight !== false);

                applyButtonPosition();
                updateWandMenuVisibility();
                initColorCustomizer(); // 색상 커스터마이저 UI 갱신 (중요)

                saveSettingsDebounced();
                toastr.success('설정 불러오기 완료');
            }

        } catch (error) {
            toastr.error('파일 오류: ' + error.message);
        }
    };

    reader.readAsText(file);
    $('#hl-color-import-input').val(''); // 파일 인풋 초기화
}
