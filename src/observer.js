// observer.js — 캐릭터/채팅 변경 감지 및 동기화
// 이벤트 핸들러, MutationObserver, 주기적 체크 함수

import { saveSettingsDebounced, chat, characters } from '../../../../../script.js';
import { state } from './state.js';
import { VIEW_LEVELS } from './constants.js';
import { getCurrentCharacterKey, getCurrentChatFile, findCharacterByKey, initCharacterCache } from './character-keys.js';
import { restoreHighlightsInChat } from './highlight-dom.js';
import { enableHighlightMode, disableHighlightMode } from './highlight-mode.js';
import { renderCharacterList, renderChatList, renderHighlightList, getActiveTab, updateBreadcrumb } from './ui-render.js';

// ====================================
// 내부 헬퍼 함수
// ====================================

function updatePanelAfterRename(currentCharId, currentChatFile) {
    const $panel = $('#highlighter-panel');
    if ($panel.length > 0 && $panel.hasClass('visible')) {
        const $content = $('#highlighter-content');
        if (state.currentView === VIEW_LEVELS.CHARACTER_LIST) {
            renderCharacterList($content, getActiveTab());
        } else if (state.currentView === VIEW_LEVELS.CHAT_LIST) {
            renderChatList($content, currentCharId, getActiveTab());
        } else if (state.currentView === VIEW_LEVELS.HIGHLIGHT_LIST) {
            updateBreadcrumb();
            renderHighlightList($content, currentCharId, currentChatFile);
        }
    }
}

// ⭐ 이전 채팅 메시지 업데이트 헬퍼
function updatePreviousChatMessages() {
    if (chat && chat.length >= 1) {
        state.previousChatMessages = {
            first3: chat.slice(0, 3).map(m => (m.mes || '').substring(0, 100)),
            last3: chat.slice(-3).map(m => (m.mes || '').substring(0, 100))
        };
    } else {
        state.previousChatMessages = null;
    }
}

// ====================================
// 채팅 이름 변경 감지
// ====================================

// ⭐ 채팅 이름 변경 버튼 클릭 가로채기 설정
export function setupRenameChatInterceptor() {
    // 이벤트 캡처 단계에서 renameChatButton 클릭 감지
    document.addEventListener('click', function (event) {
        const target = event.target.closest('.renameChatButton');
        if (target) {
            // 클릭 시점의 채팅 정보 저장
            const currentCharKey = getCurrentCharacterKey();
            const currentChatFile = getCurrentChatFile();

            if (currentCharKey && currentChatFile) {
                state.pendingRename = {
                    charKey: currentCharKey,
                    oldChatFile: currentChatFile,
                    timestamp: Date.now()
                };
                console.log(`[SillyTavern-Highlighter] Rename button clicked, saving state: charKey=${currentCharKey}, chatFile="${currentChatFile}"`);
            }
        }
    }, true); // capture phase

    console.log('[SillyTavern-Highlighter] Rename chat interceptor initialized');
}

// ====================================
// 캐릭터/채팅 변경 이벤트 핸들러
// ====================================

export function onCharacterChange() {
    // 형광펜 모드가 활성화되어 있으면 비활성화 후 대기
    if (state.isHighlightMode) {
        disableHighlightMode();
    }

    // DOM 업데이트 대기 후 하이라이트 복원 및 형광펜 모드 재활성화
    setTimeout(() => {
        // 캐릭터 변경 시 이전 상태 업데이트
        state.previousCharId = getCurrentCharacterKey();
        state.previousChatFile = getCurrentChatFile();
        state.previousChatLength = chat ? chat.length : 0;
        state.previousChatChangeTime = Date.now();

        // 현재 채팅의 첫/마지막 메시지 저장
        updatePreviousChatMessages();

        restoreHighlightsInChat();

        if (state.isHighlightMode) {
            enableHighlightMode();
        }
    }, 500);
}


export function onChatChange() {
    state.panelContentDirty = true; // 채팅/캐릭터 변경 → 패널 재렌더링 필요

    // 형광펜 모드가 활성화되어 있으면 비활성화 후 대기
    if (state.isHighlightMode) {
        disableHighlightMode();
    }

    // DOM 업데이트 대기 후 하이라이트 복원 및 형광펜 모드 재활성화
    setTimeout(() => {
        // 채팅 제목 변경 감지 및 데이터 동기화
        const currentCharKey = getCurrentCharacterKey();
        const currentChatFile = getCurrentChatFile();
        const currentChatLength = chat ? chat.length : 0;
        const currentTime = Date.now();

        // ⭐⭐ 1. 직접 감지: state.pendingRename이 있으면 우선 처리 (renameChatButton 클릭으로 저장됨)
        if (state.pendingRename && state.pendingRename.charKey === currentCharKey && currentChatFile) {
            const { oldChatFile, timestamp } = state.pendingRename;
            const timeDiff = currentTime - timestamp;

            // 5초 이내의 이름 변경만 유효
            if (timeDiff < 5000 && oldChatFile !== currentChatFile) {
                console.log(`[SillyTavern-Highlighter] Direct rename detected: "${oldChatFile}" -> "${currentChatFile}"`);

                // 형광펜 데이터 동기화
                if (state.settings.highlights[currentCharKey]?.[oldChatFile] && !state.settings.highlights[currentCharKey][currentChatFile]) {
                    state.settings.highlights[currentCharKey][currentChatFile] = state.settings.highlights[currentCharKey][oldChatFile];
                    delete state.settings.highlights[currentCharKey][oldChatFile];
                    console.log(`[SillyTavern-Highlighter] Highlight data synced: "${oldChatFile}" -> "${currentChatFile}"`);

                    // 채팅 메모도 함께 이동
                    const oldMemoKey = `${currentCharKey}_${oldChatFile}`;
                    const newMemoKey = `${currentCharKey}_${currentChatFile}`;
                    if (state.settings.chatMemos?.[oldMemoKey]) {
                        if (!state.settings.chatMemos) state.settings.chatMemos = {};
                        state.settings.chatMemos[newMemoKey] = state.settings.chatMemos[oldMemoKey];
                        delete state.settings.chatMemos[oldMemoKey];
                        console.log(`[SillyTavern-Highlighter] Chat memo synced: "${oldMemoKey}" -> "${newMemoKey}"`);
                    }

                    saveSettingsDebounced();
                    toastr.success('형광펜이 변경된 채팅 제목과 동기화되었습니다');

                    // state.selectedChat 업데이트
                    if (state.selectedChat === oldChatFile) {
                        state.selectedChat = currentChatFile;
                    }

                    // 패널 업데이트
                    updatePanelAfterRename(currentCharKey, currentChatFile);
                }

                // state.pendingRename 초기화
                state.pendingRename = null;

                // 상태 업데이트 후 하이라이트 복원
                state.previousCharId = currentCharKey;
                state.previousChatFile = currentChatFile;
                state.previousChatLength = currentChatLength;
                state.previousChatChangeTime = currentTime;
                updatePreviousChatMessages();
                restoreHighlightsInChat();
                if (state.isHighlightMode) enableHighlightMode();
                return; // 직접 감지로 처리 완료
            }

            // 타임아웃 또는 파일명 동일 -> state.pendingRename 초기화
            state.pendingRename = null;
        }

        // ⭐⭐ 2. 휴리스틱 감지 (폴백): 메시지 개수와 내용 비교
        // 1. 기본 조건: 같은 캐릭터, 같은 메시지 개수, 다른 파일 이름
        const basicCondition =
            state.previousCharId !== null &&
            currentCharKey === state.previousCharId &&
            state.previousChatFile !== null &&
            currentChatFile !== null &&
            state.previousChatFile !== currentChatFile &&
            state.previousChatLength !== null &&
            currentChatLength === state.previousChatLength &&
            currentChatLength >= 1; // ⭐ 최소 1개 이상의 메시지 (3 → 1)

        let isChatRenamed = false;

        if (basicCondition) {

            // 2. 메시지 내용 비교: 첫 3개와 마지막 3개 메시지가 동일한가?
            let messagesMatch = false;

            if (chat && state.previousChatMessages) {
                const currentFirst3 = chat.slice(0, 3).map(m => (m.mes || '').substring(0, 100));
                const currentLast3 = chat.slice(-3).map(m => (m.mes || '').substring(0, 100));

                const prevFirst3 = state.previousChatMessages.first3;
                const prevLast3 = state.previousChatMessages.last3;

                // 모든 메시지가 일치하는지 확인
                const first3Match = currentFirst3.every((msg, i) => msg === prevFirst3[i]);
                const last3Match = currentLast3.every((msg, i) => msg === prevLast3[i]);

                messagesMatch = first3Match && last3Match;
            }

            if (messagesMatch) {
                // 3. 체크포인트/분기 키워드 체크
                const checkpointKeywords = ['branch', 'checkpoint', 'fork', 'split'];
                const isCheckpointOrBranch = checkpointKeywords.some(keyword =>
                    currentChatFile.toLowerCase().includes(keyword) &&
                    !state.previousChatFile.toLowerCase().includes(keyword)
                );

                if (!isCheckpointOrBranch) {
                    // 모든 조건을 만족: 진짜 채팅 제목 변경!
                    isChatRenamed = true;
                }
            }
        }

        if (isChatRenamed && currentCharKey) {
            // ⭐ checkChatFileChanges에서 이미 처리했을 수 있으니 확인
            const alreadyMoved = !state.settings.highlights[currentCharKey]?.[state.previousChatFile] &&
                state.settings.highlights[currentCharKey]?.[currentChatFile];

            // 실제 채팅 제목 변경 - 데이터 이동
            if (state.settings.highlights[currentCharKey]?.[state.previousChatFile]) {
                // 새 파일 이름에 데이터가 없는 경우에만 이동
                if (!state.settings.highlights[currentCharKey][currentChatFile]) {
                    console.log(`[SillyTavern-Highlighter] Chat title changed (onChatChange): "${state.previousChatFile}" -> "${currentChatFile}"`);

                    // 형광펜 데이터를 새 키로 이동
                    state.settings.highlights[currentCharKey][currentChatFile] = state.settings.highlights[currentCharKey][state.previousChatFile];

                    // 이전 키 삭제
                    delete state.settings.highlights[currentCharKey][state.previousChatFile];

                    // ⭐ 채팅 메모도 함께 이동
                    const oldMemoKey = `${currentCharKey}_${state.previousChatFile}`;
                    const newMemoKey = `${currentCharKey}_${currentChatFile}`;
                    if (state.settings.chatMemos?.[oldMemoKey]) {
                        if (!state.settings.chatMemos) state.settings.chatMemos = {};
                        state.settings.chatMemos[newMemoKey] = state.settings.chatMemos[oldMemoKey];
                        delete state.settings.chatMemos[oldMemoKey];
                        console.log(`[SillyTavern-Highlighter] Chat memo moved: "${oldMemoKey}" -> "${newMemoKey}"`);
                    }

                    // 저장
                    saveSettingsDebounced();

                    toastr.success('형광펜이 변경된 채팅 제목과 동기화되었습니다');
                }
            } else if (alreadyMoved) {
                // checkChatFileChanges에서 이미 처리됨, UI만 업데이트
                console.log(`[SillyTavern-Highlighter] Chat rename already processed, updating UI only`);
            }

            // ⭐ 데이터 이동 여부와 상관없이 UI는 업데이트
            // state.selectedChat 업데이트 (breadcrumb에서 사용)
            if (state.selectedChat === state.previousChatFile) {
                state.selectedChat = currentChatFile;
            }

            // 패널이 열려있으면 즉시 업데이트
            const $panel = $('#highlighter-panel');
            if ($panel.length > 0 && $panel.hasClass('visible')) {
                const $content = $('#highlighter-content');

                if (state.currentView === VIEW_LEVELS.CHARACTER_LIST) {
                    // 캐릭터 리스트 뷰 - 전체 리스트 새로고침
                    renderCharacterList($content, getActiveTab());
                } else if (state.currentView === VIEW_LEVELS.CHAT_LIST) {
                    // 채팅 리스트 뷰 - 현재 캐릭터의 채팅 리스트만
                    renderChatList($content, currentCharKey, getActiveTab());
                } else if (state.currentView === VIEW_LEVELS.HIGHLIGHT_LIST) {
                    // 형광펜 리스트 뷰 - breadcrumb 업데이트 (채팅 제목 반영)
                    updateBreadcrumb();
                    // 형광펜 리스트도 다시 렌더링 (chatFile 기준)
                    renderHighlightList($content, currentCharKey, currentChatFile);
                }
            }
        }

        // 현재 상태 저장 (다음 비교를 위해)
        state.previousCharId = currentCharKey;
        state.previousChatFile = currentChatFile;
        state.previousChatLength = currentChatLength;
        state.previousChatChangeTime = currentTime;

        // 현재 채팅의 첫/마지막 메시지 저장
        updatePreviousChatMessages();

        restoreHighlightsInChat();

        if (state.isHighlightMode) {
            enableHighlightMode();
        }
    }, 500);
}

// ====================================
// 주기적 체크 함수 (setInterval)
// ====================================

// 채팅 파일명 변경 실시간 감지
export function checkChatFileChanges() {
    // 현재 채팅이 있을 때만 체크
    const currentCharKey = getCurrentCharacterKey();
    const currentChatFile = getCurrentChatFile();

    if (!currentCharKey || !currentChatFile) {
        return;
    }

    // 이전 정보와 비교
    if (state.previousChatFile !== null &&
        state.previousChatFile !== currentChatFile &&
        state.previousCharId === currentCharKey) {

        // 채팅 파일이 변경되었음 (제목 변경 가능성)
        console.log(`[SillyTavern-Highlighter] Chat file changed detected: "${state.previousChatFile}" -> "${currentChatFile}"`);

        // onChatChange의 제목 변경 감지 로직을 강제로 트리거
        const currentChatLength = chat ? chat.length : 0;

        // 기본 조건 체크
        if (state.previousChatLength !== null &&
            currentChatLength === state.previousChatLength &&
            currentChatLength >= 1) { // ⭐ 3 → 1로 변경 (메시지 1개 이상이면 OK)

            // 메시지 내용 비교
            let messagesMatch = false;
            if (chat && state.previousChatMessages) {
                const currentFirst3 = chat.slice(0, 3).map(m => (m.mes || '').substring(0, 100));
                const currentLast3 = chat.slice(-3).map(m => (m.mes || '').substring(0, 100));
                const prevFirst3 = state.previousChatMessages.first3;
                const prevLast3 = state.previousChatMessages.last3;
                const first3Match = currentFirst3.every((msg, i) => msg === prevFirst3[i]);
                const last3Match = currentLast3.every((msg, i) => msg === prevLast3[i]);
                messagesMatch = first3Match && last3Match;
            }

            if (messagesMatch) {
                // 체크포인트/분기 키워드 체크
                const checkpointKeywords = ['branch', 'checkpoint', 'fork', 'split'];
                const isCheckpointOrBranch = checkpointKeywords.some(keyword =>
                    currentChatFile.toLowerCase().includes(keyword) &&
                    !state.previousChatFile.toLowerCase().includes(keyword)
                );

                if (!isCheckpointOrBranch) {
                    // 진짜 제목 변경 감지!
                    if (state.settings.highlights[currentCharKey]?.[state.previousChatFile] &&
                        !state.settings.highlights[currentCharKey][currentChatFile]) {

                        console.log(`[SillyTavern-Highlighter] Real-time chat title change detected!`);

                        // 형광펜 데이터 이동
                        state.settings.highlights[currentCharKey][currentChatFile] = state.settings.highlights[currentCharKey][state.previousChatFile];
                        delete state.settings.highlights[currentCharKey][state.previousChatFile];

                        // 채팅 메모 이동
                        const oldMemoKey = `${currentCharKey}_${state.previousChatFile}`;
                        const newMemoKey = `${currentCharKey}_${currentChatFile}`;
                        if (state.settings.chatMemos?.[oldMemoKey]) {
                            if (!state.settings.chatMemos) state.settings.chatMemos = {};
                            state.settings.chatMemos[newMemoKey] = state.settings.chatMemos[oldMemoKey];
                            delete state.settings.chatMemos[oldMemoKey];
                        }

                        saveSettingsDebounced();
                        toastr.success('형광펜이 변경된 채팅 제목과 동기화되었습니다');

                        // ⭐ state.selectedChat 업데이트 (breadcrumb에서 사용)
                        if (state.selectedChat === state.previousChatFile) {
                            state.selectedChat = currentChatFile;
                        }

                        // 패널 업데이트
                        const $panel = $('#highlighter-panel');
                        if ($panel.length > 0 && $panel.hasClass('visible')) {
                            const $content = $('#highlighter-content');
                            if (state.currentView === VIEW_LEVELS.CHARACTER_LIST) {
                                renderCharacterList($content, getActiveTab());
                            } else if (state.currentView === VIEW_LEVELS.CHAT_LIST) {
                                renderChatList($content, currentCharKey, getActiveTab());
                            } else if (state.currentView === VIEW_LEVELS.HIGHLIGHT_LIST) {
                                updateBreadcrumb();
                                // 형광펜 리스트도 다시 렌더링 (chatFile 기준)
                                renderHighlightList($content, currentCharKey, currentChatFile);
                            }
                        }
                    }
                }
            }
        }

        // ⭐ 상태 업데이트 하지 않음 - onChatChange에서 처리
        // state.previousChatFile 등을 여기서 업데이트하면 onChatChange에서 감지 못함
    }
}

// 캐릭터 정보 변경 감지
export function checkCharacterChanges() {
    // 패널이 열려있을 때만 체크
    if (!$('#highlighter-panel').hasClass('visible')) {
        return;
    }

    let hasChanges = false;

    // 현재 화면에 표시된 캐릭터들만 체크
    if (state.currentView === VIEW_LEVELS.CHARACTER_LIST) {
        // 캐릭터 리스트에 있는 모든 캐릭터 체크
        const charIds = Object.keys(state.settings.highlights);
        for (const charId of charIds) {
            const charData = findCharacterByKey(charId);
            if (!charData) continue;

            const currentHash = `${charData.name}|${charData.avatar}`;

            // 이름 캐시 업데이트
            if (charData.name && (!state.settings.characterNames || state.settings.characterNames[charId] !== charData.name)) {
                if (!state.settings.characterNames) state.settings.characterNames = {};
                state.settings.characterNames[charId] = charData.name;
                saveSettingsDebounced();
            }

            if (state.characterCache[charId] !== currentHash) {
                state.characterCache[charId] = currentHash;
                hasChanges = true;
            }
        }

        if (hasChanges) {
            const $content = $('#highlighter-content');
            renderCharacterList($content, getActiveTab());
        }
    } else if (state.currentView === VIEW_LEVELS.CHAT_LIST || state.currentView === VIEW_LEVELS.HIGHLIGHT_LIST) {
        // breadcrumb의 캐릭터 이름만 체크
        if (state.selectedCharacter !== null) {
            const currentData = characters[state.selectedCharacter];
            if (currentData) {
                const cached = state.characterCache[state.selectedCharacter];
                const currentHash = `${currentData.name}|${currentData.avatar}`;

                if (cached !== currentHash) {
                    state.characterCache[state.selectedCharacter] = currentHash;
                    updateBreadcrumb();
                }
            }
        }
    }
}

// ====================================
// 캐릭터 편집/삭제 이벤트 핸들러
// ====================================

// 캐릭터 정보 수정 시 리스트 업데이트 (이벤트 기반 - 작동하면 사용)
export function onCharacterEdited() {
    // 패널이 열려있을 때 현재 뷰 업데이트
    if ($('#highlighter-panel').hasClass('visible')) {
        // 캐릭터 리스트 뷰면 리스트 업데이트
        if (state.currentView === VIEW_LEVELS.CHARACTER_LIST) {
            const $content = $('#highlighter-content');
            renderCharacterList($content, getActiveTab());
            initCharacterCache(); // 캐시 갱신
        }
        // 채팅 리스트나 하이라이트 리스트 뷰면 breadcrumb만 업데이트 (캐릭터 이름 변경 반영)
        else if (state.currentView === VIEW_LEVELS.CHAT_LIST || state.currentView === VIEW_LEVELS.HIGHLIGHT_LIST) {
            updateBreadcrumb();
            initCharacterCache(); // 캐시 갱신
        }
    }
}

export function onChatDeleted(chatFile) {
    state.panelContentDirty = true;
    const charId = getCurrentCharacterKey();
    if (!charId) return;

    if (state.settings.deleteMode === 'delete') {
        if (state.settings.highlights[charId]?.[chatFile]) {
            delete state.settings.highlights[charId][chatFile];
            toastr.info('형광펜 삭제됨');
            saveSettingsDebounced();
        }
    } else {
        toastr.info('형광펜 보관됨');
    }
}

// ====================================
// MutationObserver 설정
// ====================================

export function setupChatObserver() {
    // 기존 observer가 있으면 disconnect
    if (state.chatObserver) {
        state.chatObserver.disconnect();
        state.chatObserver = null;
    }

    const chatContainer = document.getElementById('chat');
    if (!chatContainer) {
        console.warn('[SillyTavern-Highlighter] Chat container not found, retrying...');
        setTimeout(setupChatObserver, 1000);
        return;
    }

    const observer = new MutationObserver((mutations) => {
        let shouldRestore = false;

        for (const mutation of mutations) {
            if (mutation.type !== 'childList') continue;

            // Case 1: 새로운 메시지(.mes) 추가 감지
            for (const node of mutation.addedNodes) {
                if (node.classList && node.classList.contains('mes')) {
                    shouldRestore = true;
                    break;
                }
            }
            if (shouldRestore) break;

            // Case 2: LLM 번역기 호환 - .mes_text 내 형광펜 span이 제거된 경우 감지
            // updateMessageBlock()이 .mes_text innerHTML을 교체하면 기존 형광펜이 제거됨
            if (state.settings.translatorCompat && mutation.removedNodes.length > 0) {
                const target = mutation.target;
                if (target && (
                    (target.classList && target.classList.contains('mes_text')) ||
                    (target.closest && target.closest('.mes_text'))
                )) {
                    for (const removed of mutation.removedNodes) {
                        if (removed.nodeType === Node.ELEMENT_NODE && (
                            (removed.classList && removed.classList.contains('text-highlight')) ||
                            (removed.querySelector && removed.querySelector('.text-highlight'))
                        )) {
                            shouldRestore = true;
                            break;
                        }
                    }
                }
            }
            if (shouldRestore) break;
        }

        // 디바운스로 중복 호출 방지
        if (shouldRestore) {
            clearTimeout(state.highlightRestoreTimer);
            state.highlightRestoreTimer = setTimeout(() => {
                restoreHighlightsInChat();
            }, 300);
        }
    });

    observer.observe(chatContainer, {
        childList: true,
        subtree: true
    });

    state.chatObserver = observer;
    console.log('[SillyTavern-Highlighter] Chat observer set up');
}
