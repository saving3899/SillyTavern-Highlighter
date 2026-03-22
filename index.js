import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    chat,
    characters,
} from '../../../../script.js';

import {
    getContext,
    extension_settings
} from '../../../extensions.js';

import {
    executeSlashCommandsWithOptions
} from '../../../../scripts/slash-commands.js';

import {
    openGroupById,
    openGroupChat
} from '../../../../scripts/group-chats.js';

import { state } from './src/state.js';

import {
    extensionName,
    DEFAULT_SETTINGS,
    UPDATE_CHECK_CACHE_KEY,
} from './src/constants.js';

import {
    escapeHtml,
} from './src/utils.js';

import {
    findCharacterByKey,
    findCharacterByDateAdded,
    isSameCharacterKey,
    handleCharacterRenamed,
    extractDateFromChatName,
    getCurrentCharacterKey,
    isGroupKey,
    getGroupIdFromKey,
    findGroupById,
    getCurrentChatFile,
    getCharacterNameByKey,
    initDefaultAvatarDetection,
    initCharacterCache,
} from './src/character-keys.js';

import {
    validateAndRepairSettings,
    migrateSettings,
} from './src/data.js';

import {
    initColorCustomizer,
    updateDynamicColorStyles,
    initColorCallbacks,
} from './src/color.js';

import {
    toggleBookmark,
    injectBookmarkButtons,
    initBookmarkCallbacks,
} from './src/bookmark.js';

import {
    restoreHighlightsInChat,
    initHighlightDomCallbacks,
} from './src/highlight-dom.js';

import {
    getCurrentSwipeId,
    findHighlightById,
    initHighlightCrudCallbacks,
} from './src/highlight-crud.js';

import {
    enableHighlightMode,
    initHighlightModeCallbacks,
} from './src/highlight-mode.js';

import {
    getExtensionFolderPath,
    addToWandMenu,
    updateWandMenuVisibility,
    createHighlighterUI,
    closePanel,
    applyDarkMode,
    getDarkModeClass,
    applyButtonPosition,
    updateFloatingBtnIcon,
    initUiPanelCallbacks,
} from './src/ui-panel.js';

import {
    navigateToCharacterList,
    navigateToChatList,
    navigateToHighlightList,
    renderView,
    updateTabCounts,
    initUiRenderCallbacks,
} from './src/ui-render.js';

import {
    openCharacterMemoEditor,
    openChatMemoEditor,
    showHighlightContextMenu,
    exitSelectMode,
    showBookmarkItemMoreMenu,
    showHighlightItemMoreMenu,
    showBreadcrumbMoreMenu,
    showHeaderMoreMenu,
    initUiMenusCallbacks,
} from './src/ui-menus.js';

import {
    setupChatObserver,
    setupRenameChatInterceptor,
    onCharacterChange,
    onChatChange,
    onCharacterEdited,
    checkChatFileChanges,
    checkCharacterChanges,
} from './src/observer.js';

import {
    exportHighlights,
    importHighlights,
    exportConfiguration,
    importConfiguration,
} from './src/import-export.js';

import {
    checkForUpdates,
    showUpdateNotification,
} from './src/update-checker.js';


/**
 * 연결이 끊어진 데이터(잘못된 키를 가진 형광펜 데이터)를 찾아 올바른 캐릭터에게 병합
 * 복구 우선순위:
 * 1. 이름이 같고 동일한 이름의 채팅 파일이 있음
 * 2. 이름이 같음
 */
function repairOrphanedData() {
    if (!characters || characters.length === 0) {
        toastr.warning('캐릭터 목록이 로드되지 않았습니다.');
        return;
    }

    if (!state.settings.highlights) {
        toastr.info('복구할 데이터가 없습니다.');
        return;
    }

    console.log('[SillyTavern-Highlighter] Starting unlinked data repair...');
    let repairedCount = 0;
    const highlightKeys = Object.keys(state.settings.highlights);

    highlightKeys.forEach(key => {
        // 유효한 avatar 키인지 확인 (.png로 끝나고 캐릭터가 존재함)
        if (key.endsWith('.png') && findCharacterByKey(key)) {
            return; // 이미 올바른 avatar 키
        }

        // date_added 키 또는 알 수 없는 키 -> 복구 대상
        let targetChar = null;
        let matchType = '';

        // 1. date_added로 직접 찾기 시도
        targetChar = findCharacterByDateAdded(key);
        if (targetChar) {
            matchType = 'date_added';
        } else {
            // 2. 캐싱된 이름으로 찾기
            const cachedName = state.settings.characterNames?.[key];
            if (cachedName) {
                // 동일 이름의 캐릭터 찾기
                const candidates = characters.filter(c => c.name === cachedName);

                if (candidates.length === 1) {
                    // 유일한 매칭
                    targetChar = candidates[0];
                    matchType = 'unique_name';
                } else if (candidates.length > 1) {
                    // 복수 캐릭터 -> 채팅 파일명으로 구분 시도
                    const unlinkedChatFiles = Object.keys(state.settings.highlights[key] || {});

                    for (const candidate of candidates) {
                        // 해당 캐릭터의 채팅 파일명 패턴 확인
                        // 채팅 파일명은 보통 "캐릭터명 - 날짜.jsonl" 형태
                        const matchingChat = unlinkedChatFiles.some(chatFile =>
                            chatFile.toLowerCase().includes(candidate.name.toLowerCase())
                        );
                        if (matchingChat) {
                            targetChar = candidate;
                            matchType = 'name_and_chat';
                            break;
                        }
                    }

                    if (!targetChar) {
                        console.warn(`[SillyTavern-Highlighter] Ambiguous match for ${key}: ${candidates.length} characters named "${cachedName}". Manual repair needed.`);
                    }
                }
            }
        }

        if (!targetChar) return;

        const canonicalKey = targetChar.avatar;
        if (!canonicalKey || key === canonicalKey) return;

        console.log(`[SillyTavern-Highlighter] Repairing unlinked data: ${key} -> ${canonicalKey} (${targetChar.name}) [${matchType}]`);

        // 타겟 데이터 공간 확보
        if (!state.settings.highlights[canonicalKey]) {
            state.settings.highlights[canonicalKey] = {};
        }

        const unlinkedData = state.settings.highlights[key];

        // 채팅 파일별로 순회하며 병합
        Object.keys(unlinkedData).forEach(chatFile => {
            const sourceChatData = unlinkedData[chatFile];

            if (!state.settings.highlights[canonicalKey][chatFile]) {
                state.settings.highlights[canonicalKey][chatFile] = sourceChatData;
            } else {
                // 하이라이트 배열 병합
                if (sourceChatData.highlights && Array.isArray(sourceChatData.highlights)) {
                    if (!state.settings.highlights[canonicalKey][chatFile].highlights) {
                        state.settings.highlights[canonicalKey][chatFile].highlights = [];
                    }
                    state.settings.highlights[canonicalKey][chatFile].highlights.push(...sourceChatData.highlights);
                }
            }
        });

        // 연결이 끊어진 데이터 삭제
        delete state.settings.highlights[key];
        repairedCount++;

        // 메모 데이터도 복구
        if (state.settings.characterMemos && state.settings.characterMemos[key]) {
            if (!state.settings.characterMemos[canonicalKey]) {
                state.settings.characterMemos[canonicalKey] = state.settings.characterMemos[key];
            }
            delete state.settings.characterMemos[key];
        }

        // characterNames 캐시 정리
        if (state.settings.characterNames && state.settings.characterNames[key]) {
            state.settings.characterNames[canonicalKey] = state.settings.characterNames[key];
            delete state.settings.characterNames[key];
        }
    });

    if (repairedCount > 0) {
        saveSettingsDebounced();
        toastr.success(`${repairedCount}명의 캐릭터 데이터를 복구했습니다!`);
        console.log(`[SillyTavern-Highlighter] Repaired ${repairedCount} unlinked character entries.`);

        // UI 갱신
        renderView();
        restoreHighlightsInChat();
    } else {
        toastr.info('복구할 필요가 있는 데이터가 발견되지 않았습니다.');
    }
}

/**
 * 채팅 파일명이 변경되어 연결이 끊어진 형광펜 데이터를 복구
 * 실제 채팅 파일 목록과 저장된 형광펜 데이터를 비교하여 매칭
 */
async function repairUnmatchedChatData() {
    if (!characters || characters.length === 0) {
        toastr.warning('캐릭터 목록이 로드되지 않았습니다.');
        return;
    }

    if (!state.settings.highlights) {
        toastr.info('복구할 데이터가 없습니다.');
        return;
    }

    console.log('[SillyTavern-Highlighter] Starting unmatched chat data repair...');
    let repairedCount = 0;
    const context = getContext();

    // 각 캐릭터별로 검사
    for (const charKey in state.settings.highlights) {
        const char = findCharacterByKey(charKey);
        if (!char) continue;

        const charIndex = characters.indexOf(char);
        if (charIndex === -1) continue;

        // 해당 캐릭터의 실제 채팅 목록 가져오기
        let actualChats = [];
        try {
            const response = await fetch('/api/characters/chats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ avatar_url: char.avatar })
            });
            if (response.ok) {
                const chats = await response.json();
                actualChats = chats.map(c => c.file_name.replace('.jsonl', ''));
            }
        } catch (error) {
            console.warn(`[SillyTavern-Highlighter] Failed to fetch chats for ${char.name}:`, error);
            continue;
        }

        const savedChatKeys = Object.keys(state.settings.highlights[charKey] || {});

        // 저장된 채팅 키 중 실제 채팅 목록에 없는 것 찾기
        for (const savedChatFile of savedChatKeys) {
            if (actualChats.includes(savedChatFile)) continue; // 이미 매칭됨

            // 유사한 채팅 파일 찾기 (캐릭터 이름 포함 + 날짜 유사)
            const savedDate = extractDateFromChatName(savedChatFile);
            let bestMatch = null;
            let bestScore = 0;

            for (const actualChat of actualChats) {
                // 이미 형광펜 데이터가 있는 채팅은 건너뛰기
                if (state.settings.highlights[charKey][actualChat]) continue;

                const actualDate = extractDateFromChatName(actualChat);
                if (!savedDate || !actualDate) continue;

                // 날짜 유사도 계산 (시간 차이)
                const timeDiff = Math.abs(savedDate.getTime() - actualDate.getTime());
                const hoursDiff = timeDiff / (1000 * 60 * 60);

                // 24시간 이내의 차이만 허용
                if (hoursDiff < 24) {
                    const score = 1 / (hoursDiff + 1); // 더 가까울수록 높은 점수
                    if (score > bestScore) {
                        bestScore = score;
                        bestMatch = actualChat;
                    }
                }
            }

            if (bestMatch) {
                console.log(`[SillyTavern-Highlighter] Matching chat: "${savedChatFile}" -> "${bestMatch}" (${char.name})`);

                // 데이터 이동
                state.settings.highlights[charKey][bestMatch] = state.settings.highlights[charKey][savedChatFile];
                delete state.settings.highlights[charKey][savedChatFile];

                // 채팅 메모도 이동
                const oldMemoKey = `${charKey}_${savedChatFile}`;
                const newMemoKey = `${charKey}_${bestMatch}`;
                if (state.settings.chatMemos?.[oldMemoKey]) {
                    state.settings.chatMemos[newMemoKey] = state.settings.chatMemos[oldMemoKey];
                    delete state.settings.chatMemos[oldMemoKey];
                }

                repairedCount++;
            }
        }
    }

    if (repairedCount > 0) {
        saveSettingsDebounced();
        toastr.success(`${repairedCount}개의 채팅 데이터를 복구했습니다!`);
        console.log(`[SillyTavern-Highlighter] Repaired ${repairedCount} unmatched chat entries.`);

        // UI 갱신
        renderView();
        restoreHighlightsInChat();
    } else {
        toastr.info('복구할 필요가 있는 채팅 데이터가 발견되지 않았습니다.');
    }
}
async function jumpToMessage(mesId, hlId) {
    // 모바일에서 패널 닫기
    if (window.innerWidth <= 768) {
        closePanel();
    }

    // hlId로 하이라이트가 속한 캐릭터/채팅 찾기
    const result = hlId ? findHighlightById(hlId) : null;
    const targetCharKey = result ? result.charId : state.selectedCharacter;
    const targetChatFile = result ? result.chatFile : state.selectedChat;

    const currentCharKey = getCurrentCharacterKey();
    const currentChatFile = getCurrentChatFile();

    // 같은 캐릭터이고 같은 채팅인 경우 바로 점프 (불필요한 이동 방지)
    if (isSameCharacterKey(targetCharKey, currentCharKey) && targetChatFile === currentChatFile) {
        jumpToMessageInternal(mesId, hlId);
        return;
    }

    // 캐릭터/그룹이 다른 경우 전환
    if (!isSameCharacterKey(targetCharKey, currentCharKey) && targetCharKey !== null) {

        // 그룹 채팅인 경우
        if (isGroupKey(targetCharKey)) {
            const groupId = getGroupIdFromKey(targetCharKey);
            const group = findGroupById(groupId);
            const groupName = group?.name || getCharacterNameByKey(targetCharKey);

            if (!group) {
                showDeletedChatAlert('character', groupName, targetChatFile);
                return;
            }

            toastr.info(`${groupName} 그룹으로 이동 중...`);

            try {
                // 1. 먼저 그룹을 열기 (selected_group 설정)
                await openGroupById(groupId);
                await new Promise(resolve => setTimeout(resolve, 300));

                // 2. 특정 채팅으로 전환 (현재 채팅과 다른 경우만)
                const afterGroupChatFile = getCurrentChatFile();
                if (targetChatFile && afterGroupChatFile !== targetChatFile) {
                    await openGroupChat(groupId, targetChatFile);
                    await new Promise(resolve => setTimeout(resolve, 300));
                }

                const newCharKey = getCurrentCharacterKey();
                if (isSameCharacterKey(newCharKey, targetCharKey)) {
                    jumpToMessageInternal(mesId, hlId);
                    return;
                }

                throw new Error('그룹 채팅 전환이 완료되지 않았습니다');
            } catch (error) {
                console.error('[SillyTavern-Highlighter] Group chat switch error:', error);
                toastr.error('그룹 채팅 전환 실패: ' + error.message);
                return;
            }
        }

        // 1:1 캐릭터인 경우
        const targetChar = findCharacterByKey(targetCharKey);
        const charName = getCharacterNameByKey(targetCharKey);

        // 캐릭터가 삭제되었는지 확인
        if (!targetChar || charName === 'Unknown') {
            showDeletedChatAlert('character', charName || '알 수 없음', targetChatFile);
            return;
        }

        // 캐릭터 인덱스 찾기 (avatar로 검색)
        const targetCharIndex = characters.indexOf(targetChar);

        if (targetCharIndex === -1) {
            toastr.error('캐릭터를 찾을 수 없습니다');
            return;
        }

        toastr.info(`${charName} 캐릭터로 이동 중...`);

        try {
            let success = false;

            // 방법 1: 다양한 선택자로 charId 버튼 찾기
            let $charButton = null;
            const selectors = [
                `.select_rm_characters[chid="${targetCharIndex}"]`,
                `.select_rm_characters[data-chid="${targetCharIndex}"]`,
                `#rm_button_selected_ch${targetCharIndex}`,
                `.character_select[chid="${targetCharIndex}"]`
            ];

            for (const selector of selectors) {
                $charButton = $(selector);
                if ($charButton.length > 0) {
                    console.log(`[SillyTavern-Highlighter] Found character button with selector: ${selector}`);
                    break;
                }
            }

            if ($charButton && $charButton.length > 0) {
                $charButton.trigger('click');
                await new Promise(resolve => setTimeout(resolve, 600));

                // 캐릭터 변경 확인
                const newCharKey = getCurrentCharacterKey();
                if (isSameCharacterKey(newCharKey, targetCharKey)) {
                    success = true;
                    console.log('[SillyTavern-Highlighter] Character changed successfully via button click');
                }
            }

            // 방법 2: SillyTavern 내부 API 직접 호출
            if (!success && typeof SillyTavern !== 'undefined') {
                try {
                    const context = SillyTavern.getContext();
                    if (context && typeof context.selectCharacterById === 'function') {
                        await context.selectCharacterById(String(targetCharIndex));
                        await new Promise(resolve => setTimeout(resolve, 600));

                        const newCharKey = getCurrentCharacterKey();
                        if (isSameCharacterKey(newCharKey, targetCharKey)) {
                            success = true;
                            console.log('[SillyTavern-Highlighter] Character changed successfully via selectCharacterById');
                        }
                    }
                } catch (e) {
                    console.log('[SillyTavern-Highlighter] selectCharacterById failed:', e);
                }
            }

            // 방법 3: 폴백 - 슬래시 명령어 사용 (동일 이름 캐릭터는 구분 불가능)
            if (!success) {
                console.log('[SillyTavern-Highlighter] Falling back to /char command');

                // 동일 이름 캐릭터가 여러 개 있는지 확인
                const sameNameChars = Object.keys(characters).filter(id =>
                    characters[id]?.name === charName
                );

                if (sameNameChars.length > 1) {
                    // 동일 이름 캐릭터가 있을 경우, 사용자에게 수동 전환 안내
                    toastr.error(
                        `"${charName}" 이름의 캐릭터가 ${sameNameChars.length}개 있어 자동 이동이 불가능합니다.<br><br>` +
                        '<strong>해결 방법:</strong><br>' +
                        '1. 수동으로 올바른 캐릭터를 선택하세요<br>' +
                        '2. 형광펜을 다시 클릭하면 올바른 채팅으로 이동합니다<br>' +
                        '3. 또는 캐릭터 메모 기능을 사용하여 구분하세요',
                        '자동 이동 불가',
                        {
                            timeOut: 10000,
                            extendedTimeOut: 5000,
                            escapeHtml: false
                        }
                    );
                    return; // 이동 중단
                }

                // 동일 이름이 없으면 정상적으로 이동
                await executeSlashCommandsWithOptions(`/char ${charName}`);
                await new Promise(resolve => setTimeout(resolve, 600));

                const newCharKey = getCurrentCharacterKey();
                if (isSameCharacterKey(newCharKey, targetCharKey)) {
                    success = true;
                    console.log('[SillyTavern-Highlighter] Character changed successfully via /char command');
                }
            }

            if (!success) {
                throw new Error('캐릭터 변경이 완료되지 않았습니다');
            }
        } catch (error) {
            console.error('[SillyTavern-Highlighter] Character change error:', error);
            toastr.error('캐릭터 변경 실패: ' + error.message);
            return;
        }
    }

    // 채팅이 다른 경우 - 자동으로 채팅 전환
    if (targetChatFile && targetChatFile !== getCurrentChatFile()) {
        try {
            const context = getContext();

            // 채팅 파일 존재 여부 확인 (새 파일 생성 방지)
            let chatExists = false;
            if (context.groupId) {
                // 그룹 채팅: 그룹 데이터에서 채팅 목록 확인
                const group = findGroupById(context.groupId);
                if (group?.chats) {
                    chatExists = group.chats.some(c => c === targetChatFile || c === `${targetChatFile}.jsonl`);
                }
            } else {
                // 1:1 채팅: API로 채팅 목록 조회
                const charData = findCharacterByKey(targetCharKey);
                if (charData?.avatar) {
                    const response = await fetch('/api/characters/chats', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ avatar_url: charData.avatar }),
                    });
                    if (response.ok) {
                        const chats = await response.json();
                        chatExists = chats.some(c => {
                            const name = c.file_name?.replace('.jsonl', '');
                            return name === targetChatFile;
                        });
                    }
                }
            }

            if (!chatExists) {
                const charName = getCharacterNameByKey(targetCharKey);
                showDeletedChatAlert('chat', charName, targetChatFile);
                return;
            }

            toastr.info(`${targetChatFile} 채팅으로 전환 중...`);

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
            await new Promise(resolve => setTimeout(resolve, 400));

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
                `다른 채팅의 형광펜입니다.<br>` +
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
        ? `<p>이 형광펜이 속한 캐릭터 <strong>"${charName}"</strong>가 삭제되었거나 찾을 수 없습니다.</p>
           <p>형광펜은 독서노트 패널에 보관되어 있으며, 원하시면 삭제할 수 있습니다.</p>`
        : `<p>이 형광펜이 속한 채팅 <strong>"${chatFile}"</strong>이 삭제되었거나 찾을 수 없습니다.</p>
           <p>형광펜은 독서노트 패널에 보관되어 있으며, 원하시면 삭제할 수 있습니다.</p>`;

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

    $('.hl-modal-close, .hl-modal-confirm').on('click', function () {
        $('#highlight-deleted-alert-modal').remove();
    });

    $('.hl-modal-overlay').on('click', function (e) {
        if (e.target === this) $(this).remove();
    });
}

/**
 * 하이라이트 텍스트가 메시지에 존재하는지 검증
 * @returns {boolean} 텍스트가 발견되었으면 true
 */
function verifyHighlightText($mesEl, mesId, hlId) {
    const result = findHighlightById(hlId);
    if (!result) return true; // 검증 불가 → 통과

    const hlText = result.highlight.text;
    const mesText = $mesEl.find('.mes_text').text() || '';

    const normalizedHlText = hlText.replace(/\s+/g, ' ').trim();
    const normalizedMesText = mesText.replace(/\s+/g, ' ').trim();

    let textFound = normalizedMesText.includes(normalizedHlText);

    // 단어 변환 호환: DOM에서 못 찾으면 원본 메시지에서도 확인
    if (!textFound) {
        const originalMessage = chat[mesId]?.mes || '';
        const normalizedOriginal = originalMessage.replace(/\s+/g, ' ').trim();
        textFound = normalizedOriginal.includes(normalizedHlText);
    }

    // LLM 번역기 호환: 번역문 매칭 실패 시 저장된 원문으로도 확인
    if (!textFound && state.settings.translatorCompat &&
        result.highlight.sourceType === 'translated' && result.highlight.translatorOriginalText) {
        const normalizedOrigText = result.highlight.translatorOriginalText.replace(/\s+/g, ' ').trim();
        textFound = normalizedMesText.includes(normalizedOrigText);
        if (!textFound) {
            const originalMessage = chat[mesId]?.mes || '';
            const normalizedOriginal = originalMessage.replace(/\s+/g, ' ').trim();
            textFound = normalizedOriginal.includes(normalizedOrigText);
        }
    }

    if (!textFound) {
        toastr.warning(
            '이 형광펜이 저장된 메시지가 삭제되었거나 내용이 변경되었습니다.<br>' +
            '형광펜을 삭제하는 것을 권장합니다.',
            '형광펜 불일치',
            {
                timeOut: 8000,
                extendedTimeOut: 3000,
                escapeHtml: false
            }
        );
        $mesEl[0].scrollIntoView({ behavior: 'auto', block: 'center' });
        return false;
    }
    return true;
}

/**
 * 메시지/하이라이트로 스크롤 + 플래시 효과
 */
function scrollAndFlash($mesEl, hlId) {
    if (hlId) {
        const $highlight = $mesEl.find(`.text-highlight[data-hl-id="${hlId}"]`).first();
        if ($highlight.length) {
            $highlight[0].scrollIntoView({ behavior: 'auto', block: 'center' });
            $highlight.addClass('flash-highlight');
            setTimeout(() => $highlight.removeClass('flash-highlight'), 2000);
        } else {
            $mesEl[0].scrollIntoView({ behavior: 'auto', block: 'center' });
            $mesEl.addClass('flash-highlight');
            setTimeout(() => $mesEl.removeClass('flash-highlight'), 2000);
        }
    } else {
        // hlId 없음 = 책갈피 등 메시지 단위 이동 → 최상단 정렬
        $mesEl[0].scrollIntoView({ behavior: 'auto', block: 'start' });
        $mesEl.addClass('flash-highlight');
        setTimeout(() => $mesEl.removeClass('flash-highlight'), 2000);
    }
}

async function jumpToMessageInternal(mesId, hlId) {
    const $mes = $(`.mes[mesid="${mesId}"]`);

    if ($mes.length) {
        if (hlId) {
            if (!verifyHighlightText($mes, mesId, hlId)) return;
        }
        scrollAndFlash($mes, hlId);
        toastr.info('메시지로 이동');
    } else {
        // 메시지가 로드되지 않은 경우 /chat-jump 명령어 사용
        toastr.info('메시지를 불러오는 중...');

        try {
            await executeSlashCommandsWithOptions(`/chat-jump ${mesId}`);

            setTimeout(() => {
                const $retryMes = $(`.mes[mesid="${mesId}"]`);
                if ($retryMes.length) {
                    if (hlId) {
                        if (!verifyHighlightText($retryMes, mesId, hlId)) return;
                    }
                    scrollAndFlash($retryMes, hlId);
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


(async function () {
    console.log('[SillyTavern-Highlighter] Loading...');

    const extensionFolderPath = await getExtensionFolderPath();

    // ⭐ manifest.json에서 버전 로드
    try {
        const manifestResponse = await fetch(`${extensionFolderPath}/manifest.json`);
        if (manifestResponse.ok) {
            const manifest = await manifestResponse.json();
            if (manifest.version) {
                state.EXTENSION_VERSION = manifest.version;
                console.log(`[SillyTavern-Highlighter] Version loaded from manifest: ${state.EXTENSION_VERSION}`);
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
        state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    } else {
        // 기존 데이터 존재: 검증 → 마이그레이션
        console.log('[SillyTavern-Highlighter] Loading existing data');
        state.settings = validateAndRepairSettings(loadedSettings);
        state.settings = migrateSettings(state.settings);
    }

    // extension_settings에 반영
    extension_settings[extensionName] = state.settings;

    // 마이그레이션이 발생했으면 즉시 저장 (디바운스 우회)
    if (!loadedSettings || loadedSettings.version !== state.EXTENSION_VERSION) {
        console.log('[SillyTavern-Highlighter] Saving migrated data');
        // 즉시 저장 (디바운스 없이)
        if (typeof saveSettingsDebounced === 'function' && typeof saveSettingsDebounced.flush === 'function') {
            saveSettingsDebounced.flush(); // Lodash 디바운스의 경우
        } else {
            saveSettingsDebounced();
            // 추가로 짧은 딜레이 후 한 번 더 시도
            setTimeout(() => saveSettingsDebounced(), 100);
        }
    }

    createHighlighterUI();

    // 요술봉 메뉴에 버튼 추가 (항상 추가하되, 설정에 따라 표시/숨김)
    addToWandMenu();

    try {
        const html = await $.get(`${extensionFolderPath}/settings.html`);
        $('#extensions_settings2').append(html);

        // state.settings HTML 로드 후 다크모드 클래스 적용
        applyDarkMode();

        $('#hl_setting_delete_mode').val(state.settings.deleteMode).on('change', function () {
            state.settings.deleteMode = $(this).val();
            saveSettingsDebounced();
        });

        $('#hl_setting_button_position').val(state.settings.buttonPosition).on('change', function () {
            state.settings.buttonPosition = $(this).val();
            applyButtonPosition();
            saveSettingsDebounced();
        });

        $('#hl_setting_show_floating_btn').prop('checked', state.settings.showFloatingBtn !== false).on('change', function () {
            state.settings.showFloatingBtn = $(this).is(':checked');
            // 하위 설정 표시/숨김
            $('.hl-floating-sub').toggle($(this).is(':checked'));
            applyButtonPosition();
            saveSettingsDebounced();
        });

        // 플로팅 버튼 하위 설정 초기 표시/숨김
        $('.hl-floating-sub').toggle(state.settings.showFloatingBtn !== false);

        // 플로팅 버튼 크기
        $('#hl_setting_floating_size').val(state.settings.floatingBtnSize || 'medium').on('change', function () {
            state.settings.floatingBtnSize = $(this).val();
            applyButtonPosition();
            saveSettingsDebounced();
        });

        // 플로팅 버튼 색상
        $('#hl_setting_floating_color').val(state.settings.floatingBtnColor || '#333333').on('input', function () {
            state.settings.floatingBtnColor = $(this).val();
            applyButtonPosition();
            saveSettingsDebounced();
        });

        // 플로팅 버튼 아이콘 색상
        $('#hl_setting_floating_icon_color').val(state.settings.floatingBtnIconColor || '#ffffff').on('input', function () {
            state.settings.floatingBtnIconColor = $(this).val();
            applyButtonPosition();
            saveSettingsDebounced();
        });

        // 플로팅 버튼 아이콘
        $('#hl_setting_floating_icon').val(state.settings.floatingBtnIcon || 'fa-bars').on('change', function () {
            state.settings.floatingBtnIcon = $(this).val();
            updateFloatingBtnIcon();
            saveSettingsDebounced();
        });

        $('#hl_setting_show_wand_button').prop('checked', state.settings.showWandButton !== false).on('change', function () {
            state.settings.showWandButton = $(this).is(':checked');

            // 요술봉 메뉴 버튼 표시/숨김
            updateWandMenuVisibility();

            if (state.settings.showWandButton) {
                toastr.success('요술봉 메뉴 버튼이 표시됩니다');
            } else {
                toastr.info('요술봉 메뉴 버튼이 숨겨집니다');
            }

            saveSettingsDebounced();
        });

        $('#hl_setting_always_highlight_mode').prop('checked', state.settings.alwaysHighlightMode || false).on('change', function () {
            state.settings.alwaysHighlightMode = $(this).is(':checked');

            // 항상 활성화를 체크하면 즉시 형광펜 모드 활성화
            if (state.settings.alwaysHighlightMode && !state.isHighlightMode) {
                state.isHighlightMode = true;
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

        $('#hl_setting_bookmark_position').val(state.settings.bookmarkButtonPosition || 'extraMesButtons').on('change', function () {
            state.settings.bookmarkButtonPosition = $(this).val();
            // 기존 버튼 모두 제거 후 재주입
            $('.hl-bookmark-btn').remove();
            injectBookmarkButtons();
            saveSettingsDebounced();
        });

        // LLM 번역기 호환 설정
        const $translatorCompat = $('#hl_setting_translator_compat');
        $translatorCompat.prop('checked', state.settings.translatorCompat || false).on('change', function () {
            state.settings.translatorCompat = $(this).is(':checked');
            $('.hl-translator-sub').toggle(state.settings.translatorCompat);
            saveSettingsDebounced();
        });
        $('.hl-translator-sub').toggle(state.settings.translatorCompat || false);

        $('#hl_setting_translator_panel_display').val(state.settings.translatorPanelDisplay || 'translated').on('change', function () {
            state.settings.translatorPanelDisplay = $(this).val();
            saveSettingsDebounced();
            if ($('#highlighter-panel').hasClass('visible')) renderView();
        });

        $('#hl_setting_translator_show_alt_text').prop('checked', state.settings.translatorShowAltText !== false).on('change', function () {
            state.settings.translatorShowAltText = $(this).is(':checked');
            saveSettingsDebounced();
            if ($('#highlighter-panel').hasClass('visible')) renderView();
        });

        $('#hl_setting_translator_sync_highlight').prop('checked', state.settings.translatorSyncHighlight !== false).on('change', function () {
            state.settings.translatorSyncHighlight = $(this).is(':checked');
            saveSettingsDebounced();
        });

        // 색상 커스터마이저 초기화
        initColorCustomizer();

        // 설정 내보내기/불러오기 (기존 색상 내보내기 대체)
        $('#hl-export-colors').off('click').on('click', exportConfiguration);
        $('#hl-import-colors').off('click').on('click', () => $('#hl-color-import-input').click());
        $('#hl-color-import-input').off('change').on('change', function () {
            if (this.files && this.files[0]) {
                importConfiguration(this.files[0]);
            }
        });

        // ⭐ 데이터 복구 버튼
        $('#hl-repair-orphaned-data-btn').off('click').on('click', async function () {
            if (confirm('형광펜 데이터 동기화를 실행하시겠습니까?\n\n1. 캐릭터 데이터 복구: 연결이 끊어진 형광펜 데이터를 올바른 캐릭터에게 병합합니다.\n2. 채팅 데이터 복구: 채팅 제목이 변경되어 연결이 끊어진 데이터를 복구합니다.')) {
                repairOrphanedData();
                await repairUnmatchedChatData();
            }
        });

        // 업데이트 확인 버튼
        $('#hl-check-update-btn').on('click', async function () {
            const $btn = $(this);
            const $status = $('#hl-update-status');

            // 버튼 비활성화 및 로딩 표시
            $btn.prop('disabled', true);
            $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> 확인 중...');
            $status.hide();

            try {
                // 캐시 강제 무시
                localStorage.removeItem(UPDATE_CHECK_CACHE_KEY);
                sessionStorage.removeItem(UPDATE_CHECK_CACHE_KEY);

                const updateInfo = await checkForUpdates(true); // 강제 체크

                if (updateInfo && updateInfo.version) {
                    // 업데이트 있음
                    const updateMessage = updateInfo.updateMessage ?
                        `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255, 107, 107, 0.2); font-size: 12px; color: #666;">
                            업데이트 예정 내용: ${updateInfo.updateMessage}
                        </div>` : '';

                    $status.html(`
                        <i class="fa-solid fa-circle-exclamation" style="margin-right: 2px;"></i>
                        <strong>새 버전 ${updateInfo.version}이(가) 출시되었습니다!</strong><br>
                        <span style="font-size: 12px !important;">확장 프로그램 관리에서 업데이트할 수 있습니다.</span>
                        ${updateMessage}
                    `).show();

                    // 헤더에 UPDATE! 배지 표시
                    showUpdateNotification(updateInfo.version);
                } else {
                    // 최신 버전
                    $status.html(`
                        <i class="fa-solid fa-circle-check" style="margin-right: 2px;"></i>
                        <strong>최신 버전을 사용 중입니다!</strong> (v${state.EXTENSION_VERSION})
                    `).show();
                }
            } catch (error) {
                console.error('[SillyTavern-Highlighter] Update check failed:', error);
                $status.html(`
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

    // ⭐ Settings HTML 로드 완료 후, 대기 중인 업데이트 알림이 있으면 표시
    if (state.pendingUpdateVersion) {
        console.log('[SillyTavern-Highlighter] Showing pending update notification');
        showUpdateNotification(state.pendingUpdateVersion);
    }

    // ⭐ 지연 마이그레이션: 캐릭터 로드 후 재시도
    let migrationRetried = false;
    const retryMigration = () => {
        if (!migrationRetried && characters && characters.length > 0) {
            migrationRetried = true;
            console.log('[SillyTavern-Highlighter] Retrying migration after characters loaded');

            // 인덱스 키 또는 date_added 키가 남아있는지 확인
            const keys = Object.keys(state.settings.highlights || {});
            const hasIndexKeys = keys.some(key => /^\d+$/.test(key) && parseInt(key) < 1000);
            const hasDateAddedKeys = keys.some(key => {
                const num = parseFloat(key);
                return !isNaN(num) && num > 1000000000000;
            });

            if (hasIndexKeys || hasDateAddedKeys) {
                state.settings = migrateSettings(state.settings);
                extension_settings[extensionName] = state.settings;

                // 즉시 저장
                if (typeof saveSettingsDebounced.flush === 'function') {
                    saveSettingsDebounced.flush();
                } else {
                    saveSettingsDebounced();
                }

                // 화면 갱신
                setTimeout(() => {
                    restoreHighlightsInChat();
                }, 500);
            }
        }
    };

    // 여러 타이밍에서 재시도
    setTimeout(retryMigration, 1000);  // 1초 후
    setTimeout(retryMigration, 3000);  // 3초 후
    eventSource.on(event_types.CHARACTER_SELECTED, () => {
        retryMigration();
        onCharacterChange();
    });

    eventSource.on(event_types.CHAT_CHANGED, onChatChange);
    eventSource.on(event_types.MESSAGE_RECEIVED, restoreHighlightsInChat);
    eventSource.on(event_types.MESSAGE_SENT, restoreHighlightsInChat);
    eventSource.on(event_types.MESSAGE_UPDATED, restoreHighlightsInChat);
    eventSource.on(event_types.MESSAGE_SWIPED, restoreHighlightsInChat);
    eventSource.on(event_types.CHARACTER_EDITED, onCharacterEdited);
    eventSource.on(event_types.CHARACTER_RENAMED, handleCharacterRenamed);

    // LLM 번역기 호환: 번역 완료 후 형광펜 복원
    eventSource.on('EXTENSION_LLM_TRANSLATE_UI_UPDATED', (data) => {
        if (!state.settings.translatorCompat) return;
        // 번역 UI 업데이트 후 해당 메시지의 형광펜 복원 (MutationObserver와 타이머 공유)
        clearTimeout(state.highlightRestoreTimer);
        state.highlightRestoreTimer = setTimeout(() => restoreHighlightsInChat(), 300);
    });

    // 과거 메시지 로딩 감지를 위한 MutationObserver 설정
    setupChatObserver();

    // 채팅 이름 변경 버튼 클릭 가로채기 설정
    setupRenameChatInterceptor();

    // 동적 색상 스타일 적용
    updateDynamicColorStyles();

    // 책갈피 버튼 클릭 이벤트 위임
    $(document).off('click.hlBookmark', '.hl-bookmark-btn').on('click.hlBookmark', '.hl-bookmark-btn', function (e) {
        e.stopPropagation();
        const mesId = parseInt($(this).data('mesId'));
        if (!isNaN(mesId)) {
            toggleBookmark(mesId);
        }
    });

    // 초기 상태 저장 (채팅 제목 변경 감지를 위해)
    state.previousCharId = getCurrentCharacterKey();
    state.previousChatFile = getCurrentChatFile();
    state.previousChatLength = chat ? chat.length : 0;

    restoreHighlightsInChat();

    // 캐릭터 정보 캐시 초기화
    initCharacterCache();

    // 기본 아바타(ai4.png) 지문 미리 로드
    initDefaultAvatarDetection();

    // color.js 콜백 등록 (순환 참조 방지)
    initColorCallbacks(restoreHighlightsInChat, renderView);

    // bookmark.js 콜백 등록 (순환 참조 방지)
    initBookmarkCallbacks(updateTabCounts, renderView);

    // highlight-dom.js 콜백 등록 (순환 참조 방지)
    initHighlightDomCallbacks(getCurrentSwipeId, findHighlightById, getDarkModeClass, renderView);

    // highlight-crud.js 콜백 등록 (순환 참조 방지)
    initHighlightCrudCallbacks(renderView, getDarkModeClass, navigateToCharacterList, navigateToChatList);

    // highlight-mode.js 콜백 등록 (순환 참조 방지)
    initHighlightModeCallbacks(getDarkModeClass);

    // ui-panel.js 콜백 등록 (순환 참조 방지)
    initUiPanelCallbacks(
        renderView,
        showHeaderMoreMenu,
        importHighlights,
        showHighlightContextMenu,
        navigateToChatList,
        navigateToHighlightList,
        openCharacterMemoEditor,
        openChatMemoEditor,
        jumpToMessage,
        showHighlightItemMoreMenu,
        showBookmarkItemMoreMenu,
    );

    // ui-render.js 콜백 등록 (순환 참조 방지)
    initUiRenderCallbacks(showBreadcrumbMoreMenu, exitSelectMode);

    // ui-menus.js 콜백 등록 (순환 참조 방지)
    initUiMenusCallbacks(exportHighlights, repairOrphanedData);

    // 캐릭터 정보 변경 감지 타이머 (2초마다 체크)
    setInterval(checkCharacterChanges, 2000);

    // 채팅 파일명 변경 실시간 감지 타이머 (1초마다 체크)
    setInterval(checkChatFileChanges, 1000);

    // 항상 활성화 모드가 켜져 있으면 초기화 시 자동 활성화
    if (state.settings.alwaysHighlightMode) {
        setTimeout(() => {
            state.isHighlightMode = true;
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
            const updateInfo = await checkForUpdates();
            if (updateInfo && updateInfo.version) {
                showUpdateNotification(updateInfo.version);
            }
        } catch (error) {
            console.warn('[SillyTavern-Highlighter] Update check failed silently:', error);
        }
    }, 2000); // 2초 후 실행 (다른 초기화 완료 후)
})();
