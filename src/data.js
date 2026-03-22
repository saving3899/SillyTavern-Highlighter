import {
    DEFAULT_SETTINGS,
    DEFAULT_COLORS,
    DEFAULT_PRESET,
    createEmptyPreset,
    extensionName,
} from './constants.js';
import { state } from './state.js';
import {
    findCharacterByDateAdded,
    findCharacterByKey,
    getCharacterKey,
} from './character-keys.js';
import { characters } from '../../../../../script.js';
import { getContext, extension_settings } from '../../../../extensions.js';

export function validateAndRepairSettings(data) {
    try {
        // 필수 필드 확인 및 기본값 설정
        if (!data || typeof data !== 'object') {
            console.warn('[SillyTavern-Highlighter] Invalid state.settings, using defaults');
            return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        }

        // 필수 필드 존재 확인 (없으면 추가, 기존 값은 유지)
        if (!data.highlights) data.highlights = {};
        if (!data.bookmarks) data.bookmarks = {};
        if (!data.characterMemos) data.characterMemos = {};
        if (!data.characterNames) data.characterNames = {}; // 이름 캐시 초기화
        if (!data.chatMemos) data.chatMemos = {};
        if (!data.deleteMode) data.deleteMode = 'keep';
        if (data.darkMode === undefined) data.darkMode = false;
        if (!data.buttonPosition) data.buttonPosition = 'bottom-right';
        if (data.showFloatingBtn === undefined) data.showFloatingBtn = true;
        if (data.showWandButton === undefined) data.showWandButton = true;
        if (data.alwaysHighlightMode === undefined) data.alwaysHighlightMode = false;
        if (!data.bookmarkButtonPosition) data.bookmarkButtonPosition = 'extraMesButtons';
        if (data.showTabCounts === undefined) data.showTabCounts = true;
        // LLM 번역기 호환 설정 마이그레이션
        if (data.translatorCompat === undefined) data.translatorCompat = false;
        if (!data.translatorPanelDisplay) data.translatorPanelDisplay = 'translated';
        if (data.translatorShowAltText === undefined) data.translatorShowAltText = true;
        if (data.translatorSyncHighlight === undefined) data.translatorSyncHighlight = true;
        if (!data.sortOptions) {
            data.sortOptions = {
                characters: 'modified',
                chats: 'modified',
                highlights: 'created',
                directions: { characters: 'desc', chats: 'desc', highlights: 'desc' }
            };
        }
        if (!data.sortOptions.directions) {
            data.sortOptions.directions = { characters: 'desc', chats: 'desc', highlights: 'desc' };
        }

        // 프리셋 시스템 마이그레이션
        if (!data.colorPresets) {
            console.log('[SillyTavern-Highlighter] Migrating to preset system');

            // 기존 customColors가 있으면 프리셋 1번에 저장
            const existingColors = data.customColors || JSON.parse(JSON.stringify(DEFAULT_COLORS));

            data.colorPresets = [
                JSON.parse(JSON.stringify(DEFAULT_PRESET)), // 0: 기본 프리셋
                {
                    name: '프리셋 1',
                    isDefault: false,
                    colors: JSON.parse(JSON.stringify(existingColors))
                },
                createEmptyPreset(2),
                createEmptyPreset(3),
                createEmptyPreset(4),
                createEmptyPreset(5)
            ];

            // 기존 사용자는 프리셋 1번을 활성화 (기존 색상 유지)
            data.currentPresetIndex = data.customColors ? 1 : 0;

            console.log(`[SillyTavern-Highlighter] Migrated to preset ${data.currentPresetIndex}`);
        }

        // currentPresetIndex 기본값 설정
        if (data.currentPresetIndex === undefined) {
            data.currentPresetIndex = 0;
        }

        // customColors는 현재 활성 프리셋의 colors를 가리키도록 (하위 호환성)
        if (data.colorPresets && data.colorPresets[data.currentPresetIndex]) {
            data.customColors = data.colorPresets[data.currentPresetIndex].colors;
        } else {
            data.customColors = JSON.parse(JSON.stringify(DEFAULT_COLORS));
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
        console.error('[SillyTavern-Highlighter] Error validating state.settings:', error);
        // 에러 발생 시에도 원본 데이터 반환 (기본값으로 교체하지 않음)
        return data || JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
}

// 데이터 마이그레이션
export function migrateSettings(data) {
    try {
        const currentVersion = data.version || null;
        console.log(`[SillyTavern-Highlighter] Running migration from ${currentVersion || 'unknown'} to ${state.EXTENSION_VERSION}`);

        // ⭐ 안전장치 추가: 캐릭터 데이터가 아직 로드되지 않았으면 마이그레이션 중단
        // (retryMigration에서 다시 시도할 것이므로 안전함)
        if (!characters || characters.length === 0) {
            console.log('[SillyTavern-Highlighter] Characters not loaded yet. Skipping migration.');
            return data;
        }

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

        // ⭐ v1.2.0: date_added 기반 → avatar 기반 마이그레이션
        migrateToAvatarKeys(data);

        // 레거시: 인덱스 기반 → date_added → avatar 변환
        migrateToDateAddedKeys(data);

        // ⭐ v1.3.5: 그룹 채팅 데이터 마이그레이션
        migrateGroupChatHighlights(data);

        // 버전 업데이트
        data.version = state.EXTENSION_VERSION;

        console.log('[SillyTavern-Highlighter] Migration completed');
        return data;
    } catch (error) {
        console.error('[SillyTavern-Highlighter] Migration error:', error);
        // 에러 발생해도 원본 데이터 반환
        return data;
    }
}

/**
 * 그룹 채팅 형광펜 마이그레이션
 * 기존에 캐릭터 avatar 키 아래 저장된 그룹 채팅 형광펜을 group_<groupId> 키로 이동
 */
export function migrateGroupChatHighlights(data) {
    if (!data.highlights || typeof data.highlights !== 'object') return;

    const context = getContext();
    const groups = context.groups;
    if (!groups || groups.length === 0) return;

    // 모든 그룹의 chatId를 groupId에 매핑
    const chatToGroupMap = {};
    groups.forEach(group => {
        if (group.chats && Array.isArray(group.chats)) {
            group.chats.forEach(chatId => {
                chatToGroupMap[chatId] = group.id;
            });
        }
    });

    if (Object.keys(chatToGroupMap).length === 0) return;

    let migrated = 0;

    // 캐릭터 키(avatar)에 저장된 형광펜 중 그룹 채팅에 속하는 것을 이동
    const charKeys = Object.keys(data.highlights).filter(k => !k.startsWith('group_'));

    for (const charKey of charKeys) {
        const chats = data.highlights[charKey];
        if (!chats || typeof chats !== 'object') continue;

        const chatFiles = Object.keys(chats);
        for (const chatFile of chatFiles) {
            const groupId = chatToGroupMap[chatFile];
            if (!groupId) continue; // 그룹 채팅이 아님

            const groupKey = `group_${groupId}`;
            const chatData = chats[chatFile];

            if (!chatData || !chatData.highlights || chatData.highlights.length === 0) continue;

            // 그룹 키로 이동
            if (!data.highlights[groupKey]) data.highlights[groupKey] = {};

            if (!data.highlights[groupKey][chatFile]) {
                // 새로 이동
                data.highlights[groupKey][chatFile] = chatData;
            } else {
                // 이미 존재하면 중복 없이 병합
                const existingIds = new Set(data.highlights[groupKey][chatFile].highlights.map(h => h.id));
                const newHighlights = chatData.highlights.filter(h => !existingIds.has(h.id));
                data.highlights[groupKey][chatFile].highlights.push(...newHighlights);
                data.highlights[groupKey][chatFile].lastModified = Math.max(
                    data.highlights[groupKey][chatFile].lastModified || 0,
                    chatData.lastModified || 0
                );
            }

            // 원본에서 제거
            delete chats[chatFile];
            migrated++;
        }

        // 캐릭터 키 아래 채팅이 비었으면 정리
        if (Object.keys(data.highlights[charKey]).length === 0) {
            delete data.highlights[charKey];
        }
    }

    // 캐릭터 메모도 이동 (chatMemos 키: "charKey_chatFile")
    if (data.chatMemos && migrated > 0) {
        const memoKeys = Object.keys(data.chatMemos);
        for (const memoKey of memoKeys) {
            // "charKey_chatFile" 형태에서 chatFile 추출
            const underscoreIdx = memoKey.indexOf('_');
            if (underscoreIdx === -1) continue;
            const charKey = memoKey.substring(0, underscoreIdx);
            const chatFile = memoKey.substring(underscoreIdx + 1);

            if (charKey.startsWith('group_')) continue; // 이미 그룹 메모

            const groupId = chatToGroupMap[chatFile];
            if (!groupId) continue;

            const newMemoKey = `group_${groupId}_${chatFile}`;
            if (!data.chatMemos[newMemoKey]) {
                data.chatMemos[newMemoKey] = data.chatMemos[memoKey];
            }
            delete data.chatMemos[memoKey];
        }
    }

    if (migrated > 0) {
        console.log(`[SillyTavern-Highlighter] Group chat migration: ${migrated} chat(s) moved to group keys`);
    }
}

/**
 * date_added 키를 avatar 키로 마이그레이션
 * (SillyTavern 표준 방식으로 전환)
 */
export function migrateToAvatarKeys(data) {
    if (!data.highlights || typeof data.highlights !== 'object') return;
    if (!characters || characters.length === 0) return;

    const keys = Object.keys(data.highlights);
    // date_added 형식 키만 필터링 (숫자형이고 1000000000000 이상)
    const dateAddedKeys = keys.filter(key => {
        const num = parseFloat(key);
        return !isNaN(num) && num > 1000000000000;
    });

    if (dateAddedKeys.length === 0) return;

    console.log(`[SillyTavern-Highlighter] Migrating ${dateAddedKeys.length} date_added keys to avatar keys...`);

    let migratedCount = 0;

    for (const oldKey of dateAddedKeys) {
        const char = findCharacterByDateAdded(oldKey);
        if (char && char.avatar) {
            const newKey = char.avatar;
            if (newKey !== oldKey) {
                if (!data.highlights[newKey]) {
                    // 새 키로 이동
                    data.highlights[newKey] = data.highlights[oldKey];
                } else {
                    // 새 키에 이미 데이터가 있으면 병합
                    const oldData = data.highlights[oldKey];
                    const newData = data.highlights[newKey];
                    for (const chatFile in oldData) {
                        if (!newData[chatFile]) {
                            newData[chatFile] = oldData[chatFile];
                        } else {
                            // 채팅별로 형광펜 병합 (중복 ID 제외)
                            const existingIds = new Set(newData[chatFile].highlights.map(h => h.id));
                            oldData[chatFile].highlights.forEach(h => {
                                if (!existingIds.has(h.id)) {
                                    newData[chatFile].highlights.push(h);
                                }
                            });
                        }
                    }
                }
                // 항상 old key 삭제
                delete data.highlights[oldKey];
                migratedCount++;
                console.log(`[SillyTavern-Highlighter] Migrated: ${oldKey} → ${newKey} (${char.name})`);

                // characterNames 캐시도 업데이트
                if (data.characterNames) {
                    if (data.characterNames[oldKey] && !data.characterNames[newKey]) {
                        data.characterNames[newKey] = data.characterNames[oldKey];
                    }
                    delete data.characterNames[oldKey];
                }
            }
        }
    }

    // characterMemos도 마이그레이션 (in-place)
    if (data.characterMemos) {
        const keysToMigrate = Object.keys(data.characterMemos).filter(key => {
            const num = parseFloat(key);
            return !isNaN(num) && num > 1000000000000;
        });
        for (const oldKey of keysToMigrate) {
            const char = findCharacterByDateAdded(oldKey);
            if (char && char.avatar && !data.characterMemos[char.avatar]) {
                data.characterMemos[char.avatar] = data.characterMemos[oldKey];
            }
            delete data.characterMemos[oldKey];
        }
    }

    if (migratedCount > 0) {
        console.log(`[SillyTavern-Highlighter] Avatar migration: ${migratedCount} keys migrated`);
    }

    // ⭐ 빈 키 정리 (형광펜이 없는 키 삭제)
    const allKeys = Object.keys(data.highlights);
    let cleanedCount = 0;
    for (const key of allKeys) {
        const charData = data.highlights[key];
        if (!charData || typeof charData !== 'object') {
            delete data.highlights[key];
            cleanedCount++;
            continue;
        }

        // 채팅 파일 확인
        const chatFiles = Object.keys(charData);
        if (chatFiles.length === 0) {
            delete data.highlights[key];
            cleanedCount++;
            continue;
        }

        // 모든 채팅에 형광펜이 있는지 확인
        let hasHighlights = false;
        for (const chatFile of chatFiles) {
            const chatData = charData[chatFile];
            if (chatData && chatData.highlights && chatData.highlights.length > 0) {
                hasHighlights = true;
                break;
            }
        }

        if (!hasHighlights) {
            delete data.highlights[key];
            cleanedCount++;
        }
    }

    if (cleanedCount > 0) {
        console.log(`[SillyTavern-Highlighter] Cleaned ${cleanedCount} empty keys`);
    }
}

/**
 * 인덱스 기반 키를 date_added/avatar 기반으로 마이그레이션 (레거시)
 * 경고: 이미 배열 순서가 바뀐 경우 완벽한 복구는 불가능
 */
export function migrateToDateAddedKeys(data) {
    if (!data.highlights || typeof data.highlights !== 'object') {
        return;
    }

    // ⭐ 추가 안전장치: 캐릭터 데이터 확인
    if (!characters || characters.length === 0) {
        console.warn('[SillyTavern-Highlighter] Cannot migrate keys: Characters not loaded.');
        return;
    }

    // 마이그레이션 필요 여부 확인: 인덱스 형식 키가 있는지 체크
    const keys = Object.keys(data.highlights);
    const hasIndexKeys = keys.some(key => {
        // 숫자만 있거나, 3자리 이하 숫자 = 인덱스
        return /^\d+$/.test(key) && parseInt(key) < 1000;
    });

    if (!hasIndexKeys) {
        // 이미 완료된 경우에도 색상 연동은 체크해야 함
        linkExistingHighlightsToSlots(data);
        return;
    }

    console.log('[SillyTavern-Highlighter] Migrating character keys from index to avatar...');

    const newHighlights = {};
    let migratedCount = 0;
    let failedCount = 0;

    for (const oldKey in data.highlights) {
        const charKey = getCharacterKey(oldKey);

        if (charKey) {
            newHighlights[charKey] = data.highlights[oldKey];
            migratedCount++;

            const char = findCharacterByKey(charKey);
            console.log(`[SillyTavern-Highlighter] Migrated: index ${oldKey} → ${charKey} (${char?.name || 'Unknown'})`);
        } else {
            // 변환 실패 시 원본 키 유지 (데이터 보존)
            console.warn(`[SillyTavern-Highlighter] Failed to migrate key: ${oldKey}, keeping original`);
            newHighlights[oldKey] = data.highlights[oldKey];
            failedCount++;
        }
    }

    data.highlights = newHighlights;

    // characterMemos와 chatMemos도 마이그레이션
    if (data.characterMemos) {
        const newMemos = {};
        for (const oldKey in data.characterMemos) {
            const charKey = getCharacterKey(oldKey);
            if (charKey) {
                newMemos[charKey] = data.characterMemos[oldKey];
            } else {
                newMemos[oldKey] = data.characterMemos[oldKey];
            }
        }
        data.characterMemos = newMemos;
    }

    if (data.chatMemos) {
        const newChatMemos = {};
        for (const oldKey in data.chatMemos) {
            // chatMemos 키 형식: "charId_chatFile"
            const parts = oldKey.split('_');
            if (parts.length >= 2) {
                const oldCharId = parts[0];
                const chatFile = parts.slice(1).join('_'); // chatFile에 _가 있을 수 있음
                const newCharKey = getCharacterKey(oldCharId);

                if (newCharKey) {
                    newChatMemos[`${newCharKey}_${chatFile}`] = data.chatMemos[oldKey];
                } else {
                    newChatMemos[oldKey] = data.chatMemos[oldKey];
                }
            } else {
                newChatMemos[oldKey] = data.chatMemos[oldKey];
            }
        }
        data.chatMemos = newChatMemos;
    }

    console.log(`[SillyTavern-Highlighter] Migration summary: ${migratedCount} success, ${failedCount} failed`);

    if (migratedCount > 0) {
        // ⭐ extension_settings에 즉시 반영 (디바운스 우회)
        if (typeof extension_settings !== 'undefined') {
            extension_settings[extensionName] = data;
        }
    }

    // ⭐ 색상 연동을 위한 ID 연결 작업 수행
    linkExistingHighlightsToSlots(data);
}

/**
 * 기존 형광펜들의 색상을 현재 프리셋의 슬롯(Index)과 연결
 * (이 작업을 통해 색상 프리셋을 변경하면 기존 형광펜 색상도 같이 바뀌게 됨)
 */
export function linkExistingHighlightsToSlots(data) {
    if (!data.highlights) return;

    // ⭐ 추가 안전장치
    if (!characters || characters.length === 0) return;

    let linkedCount = 0;
    const currentColors = getColorsFromPreset(data); // 현재 프리셋 색상 가져오기

    for (const charId in data.highlights) {
        for (const chatFile in data.highlights[charId]) {
            const chatData = data.highlights[charId][chatFile];
            if (chatData && Array.isArray(chatData.highlights)) {
                chatData.highlights.forEach(hl => {
                    // colorIndex가 없거나 유효하지 않은 경우
                    if (hl.colorIndex === undefined || hl.colorIndex === null) {
                        // 현재 색상과 일치하는 슬롯 찾기
                        const slotIndex = currentColors.findIndex(c => c.bg === hl.color);
                        if (slotIndex !== -1) {
                            hl.colorIndex = slotIndex;
                            linkedCount++;
                        }
                    }
                });
            }
        }
    }

    if (linkedCount > 0) {
        console.log(`[SillyTavern-Highlighter] Linked ${linkedCount} highlights to color slots`);
    }
}

// 데이터 객체에서 바로 색상 가져오기 (getColors는 전역 state.settings 의존하므로 별도 구현)
export function getColorsFromPreset(data) {
    if (data.colorPresets && data.colorPresets[data.currentPresetIndex]) {
        return data.colorPresets[data.currentPresetIndex].colors;
    }
    return data.customColors || []; // 폴백
}
