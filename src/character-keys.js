import { state } from './state.js';
import { saveSettingsDebounced, characters, this_chid } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';

/**
 * 캐릭터의 고유 키를 반환 (avatar 파일명)
 * @param {number|string|object} charIndexOrKey - 배열 인덱스, avatar 문자열, 또는 캐릭터 객체
 * @returns {string|null} avatar 키 (예: "MyCharacter.png")
 */
export function getCharacterKey(charIndexOrKey) {
    // 캐릭터 객체가 직접 전달된 경우
    if (typeof charIndexOrKey === 'object' && charIndexOrKey !== null && charIndexOrKey.avatar) {
        return charIndexOrKey.avatar;
    }

    if (typeof charIndexOrKey === 'string') {
        // 이미 avatar 형식인 경우 (.png로 끝남)
        if (charIndexOrKey.endsWith('.png')) {
            return charIndexOrKey;
        }
        // 레거시: date_added 형식인 경우 (숫자형 문자열) - 변환 시도
        if (charIndexOrKey.includes('.') || parseFloat(charIndexOrKey) > 1000000000000) {
            const char = findCharacterByDateAdded(charIndexOrKey);
            return char ? char.avatar : null;
        }
    }

    // 인덱스로 간주하고 변환
    const index = typeof charIndexOrKey === 'string' ? parseInt(charIndexOrKey) : charIndexOrKey;
    if (typeof index !== 'number' || isNaN(index) || index < 0) {
        return null;
    }

    // characters 배열이 아직 로드되지 않았거나 범위 밖인 경우
    if (!characters || !characters[index]) {
        return null;
    }

    return characters[index].avatar;
}

/**
 * 키로 캐릭터 찾기 (avatar 기반, date_added 폴백 지원)
 * @param {string} key - avatar 키 또는 레거시 date_added 키
 * @returns {object|null} 캐릭터 객체
 */
export function findCharacterByKey(key) {
    if (!key || !characters || characters.length === 0) return null;

    const keyStr = String(key);

    // 1. avatar로 찾기 (최우선)
    if (keyStr.endsWith('.png')) {
        return characters.find(c => c.avatar === keyStr) || null;
    }

    // 2. 레거시: date_added로 찾기 (마이그레이션/복구용)
    if (keyStr.includes('.') || parseFloat(keyStr) > 1000000000000) {
        return findCharacterByDateAdded(keyStr);
    }

    // 3. 인덱스로 찾기 (최후 폴백)
    const index = parseInt(keyStr);
    if (!isNaN(index) && index >= 0 && index < characters.length) {
        return characters[index];
    }

    return null;
}

/**
 * date_added 값으로 캐릭터 찾기 (레거시 지원/마이그레이션용)
 * @param {string} dateAddedKey - date_added 타임스탬프 문자열
 * @returns {object|null} 캐릭터 객체
 */
export function findCharacterByDateAdded(dateAddedKey) {
    if (!characters || characters.length === 0) return null;

    const keyStr = String(dateAddedKey);

    return characters.find(c => {
        if (String(c.date_added) === keyStr) return true;

        // 숫자형 느슨한 비교 (소수점 정밀도 차이)
        const numA = Number(c.date_added);
        const numB = Number(keyStr);
        if (!isNaN(numA) && !isNaN(numB) && Math.abs(numA - numB) < 0.001) {
            return true;
        }

        return false;
    }) || null;
}

/**
 * 두 캐릭터 키가 같은 캐릭터를 가리키는지 확인
 * (avatar와 date_added 형식이 섞여있어도 비교 가능)
 * @param {string} key1 - 첫 번째 키
 * @param {string} key2 - 두 번째 키
 * @returns {boolean} 같은 캐릭터인지 여부
 */
export function isSameCharacterKey(key1, key2) {
    if (!key1 || !key2) return false;

    const str1 = String(key1);
    const str2 = String(key2);

    // 직접 비교
    if (str1 === str2) return true;

    // 둘 다 캐릭터 객체로 해석 시도
    const char1 = findCharacterByKey(str1);
    const char2 = findCharacterByKey(str2);

    if (char1 && char2) {
        // 같은 캐릭터 객체인지 확인
        return char1 === char2 || char1.avatar === char2.avatar;
    }

    return false;
}

/**
 * 특정 캐릭터의 채팅 파일에 대한 하이라이트 배열 반환
 * (avatar 키와 date_added 키 둘 다 확인)
 * @param {string} charKey - 캐릭터 키 (avatar 또는 date_added)
 * @param {string} chatFile - 채팅 파일명
 * @returns {Array} 하이라이트 배열
 */
export function getHighlightsForChatFile(charKey, chatFile) {
    if (!state.settings.highlights || !charKey || !chatFile) return [];

    // 1. 직접 키로 찾기
    if (state.settings.highlights[charKey]?.[chatFile]?.highlights) {
        return state.settings.highlights[charKey][chatFile].highlights;
    }

    // 2. 캐릭터 객체로 변환 후 다른 키 형식으로 찾기
    const char = findCharacterByKey(charKey);
    if (char) {
        // avatar로 찾기
        if (char.avatar && state.settings.highlights[char.avatar]?.[chatFile]?.highlights) {
            return state.settings.highlights[char.avatar][chatFile].highlights;
        }
        // date_added로 찾기
        const dateKey = String(char.date_added);
        if (state.settings.highlights[dateKey]?.[chatFile]?.highlights) {
            return state.settings.highlights[dateKey][chatFile].highlights;
        }
    }

    return [];
}

/**
 * 캐릭터 이름 변경 시 데이터 키 자동 업데이트
 * (SillyTavern CHARACTER_RENAMED 이벤트 핸들러)
 * @param {string} oldAvatar - 기존 avatar 파일명
 * @param {string} newAvatar - 새로운 avatar 파일명
 */
export function handleCharacterRenamed(oldAvatar, newAvatar) {
    if (!oldAvatar || !newAvatar || oldAvatar === newAvatar) return;

    console.log(`[SillyTavern-Highlighter] Character renamed: ${oldAvatar} -> ${newAvatar}`);

    let updated = false;

    // highlights 데이터 이동
    if (state.settings.highlights && state.settings.highlights[oldAvatar]) {
        state.settings.highlights[newAvatar] = state.settings.highlights[oldAvatar];
        delete state.settings.highlights[oldAvatar];
        updated = true;
    }

    // characterMemos 데이터 이동
    if (state.settings.characterMemos && state.settings.characterMemos[oldAvatar]) {
        state.settings.characterMemos[newAvatar] = state.settings.characterMemos[oldAvatar];
        delete state.settings.characterMemos[oldAvatar];
        updated = true;
    }

    // characterNames 캐시 업데이트
    if (state.settings.characterNames && state.settings.characterNames[oldAvatar]) {
        state.settings.characterNames[newAvatar] = state.settings.characterNames[oldAvatar];
        delete state.settings.characterNames[oldAvatar];
        updated = true;
    }

    // chatMemos 키 업데이트 (charId_chatFile 형식)
    if (state.settings.chatMemos) {
        const oldPrefix = `${oldAvatar}_`;
        const keysToUpdate = Object.keys(state.settings.chatMemos).filter(k => k.startsWith(oldPrefix));
        keysToUpdate.forEach(oldKey => {
            const chatFile = oldKey.substring(oldPrefix.length);
            const newKey = `${newAvatar}_${chatFile}`;
            state.settings.chatMemos[newKey] = state.settings.chatMemos[oldKey];
            delete state.settings.chatMemos[oldKey];
            updated = true;
        });
    }

    if (updated) {
        saveSettingsDebounced();
        console.log(`[SillyTavern-Highlighter] Data migrated from ${oldAvatar} to ${newAvatar}`);
    }
}

/**
 * 채팅 파일명에서 날짜 추출 (예: "캐릭터명 - December 25, 2024 7_30 PM")
 */
export function extractDateFromChatName(chatName) {
    try {
        // 패턴 1: "캐릭터명 - Month DD, YYYY H_MM AM/PM"
        const datePattern1 = /(\w+ \d+, \d{4} \d+[_:]\d+ [AP]M)/i;
        const match1 = chatName.match(datePattern1);
        if (match1) {
            const dateStr = match1[1].replace(/_/g, ':');
            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) return parsed;
        }

        // 패턴 2: ISO 형식 또는 다른 날짜 형식
        const datePattern2 = /(\d{4}[-\/]\d{2}[-\/]\d{2})/;
        const match2 = chatName.match(datePattern2);
        if (match2) {
            const parsed = new Date(match2[1]);
            if (!isNaN(parsed.getTime())) return parsed;
        }

        // 패턴 3: 타임스탬프
        const timestampPattern = /(\d{13})/;
        const match3 = chatName.match(timestampPattern);
        if (match3) {
            const parsed = new Date(parseInt(match3[1]));
            if (!isNaN(parsed.getTime())) return parsed;
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * 현재 선택된 캐릭터/그룹의 고유 키를 반환
 * 그룹 채팅이면 "group_<groupId>", 1:1이면 avatar 문자열
 * @returns {string|null}
 */
export function getCurrentCharacterKey() {
    const context = getContext();
    if (context.groupId) {
        return `group_${context.groupId}`;
    }
    return getCharacterKey(this_chid);
}

/**
 * 키가 그룹 키인지 확인
 * @param {string} key
 * @returns {boolean}
 */
export function isGroupKey(key) {
    return typeof key === 'string' && key.startsWith('group_');
}

/**
 * 그룹 키에서 그룹 ID 추출
 * @param {string} key - "group_<groupId>" 형식
 * @returns {string|null}
 */
export function getGroupIdFromKey(key) {
    if (!isGroupKey(key)) return null;
    return key.substring(6); // "group_" 이후
}

/**
 * 그룹 ID로 그룹 객체 찾기
 * @param {string} groupId
 * @returns {object|null}
 */
export function findGroupById(groupId) {
    const context = getContext();
    return context.groups?.find(g => g.id === groupId) || null;
}

/**
 * 그룹 아바타 HTML 생성 (멤버 콜라주 또는 커스텀 아바타)
 * SillyTavern의 getGroupAvatar 방식을 차용
 */
export function buildGroupAvatarHtml(group) {
    if (!group) {
        return '<div class="hl-icon hl-group-collage"><i class="fa-solid fa-user-slash" style="font-size:16px;color:#999;"></i></div>';
    }

    // 커스텀 아바타가 있으면 단일 이미지 사용 (dataURL 또는 user/ 경로)
    const url = group.avatar_url;
    const hasCustomAvatar = url && (url.startsWith('data:') || url.startsWith('user') || url.startsWith('/user'));
    if (hasCustomAvatar) {
        return `<img src="${url}" class="hl-icon hl-group-avatar">`;
    }

    // 멤버 아바타로 콜라주 생성
    const memberAvatars = [];
    if (Array.isArray(group.members)) {
        for (const member of group.members) {
            const char = characters.find(x => x.avatar === member);
            if (char && char.avatar !== 'none') {
                memberAvatars.push(`/thumbnail?file=${encodeURIComponent(char.avatar)}&type=avatar`);
            }
            if (memberAvatars.length === 4) break;
        }
    }

    const count = memberAvatars.length;
    if (count === 0) {
        return '<div class="hl-icon hl-group-collage"><i class="fa-solid fa-users" style="font-size:16px;color:#999;"></i></div>';
    }

    const imgs = memberAvatars.map((src, i) =>
        `<img class="hl-collage-img hl-collage-img-${i + 1}" src="${src}">`
    ).join('');

    return `<div class="hl-icon hl-group-collage hl-collage-${count}">${imgs}</div>`;
}

export function getCurrentChatFile() {
    const context = getContext();
    return context.chatId || context.chat_metadata?.file_name || null;
}

export function getCharacterName(charId) {
    return characters[charId]?.name || 'Unknown';
}

/**
 * 키로 캐릭터 이름 가져오기 (date_added 지원)
 * @param {string} key - date_added 키 또는 인덱스
 * @returns {string}
 */
export function getCharacterNameByKey(key) {
    // 그룹 키인 경우
    if (isGroupKey(key)) {
        const groupId = getGroupIdFromKey(key);
        const group = findGroupById(groupId);
        if (group && group.name) return group.name;
        // 캐시 확인
        if (state.settings.characterNames && state.settings.characterNames[key]) {
            return state.settings.characterNames[key];
        }
        return 'Unknown Group';
    }

    const char = findCharacterByKey(key);
    // 1. 현재 로드된 캐릭터 목록에서 찾기
    if (char && char.name) {
        return char.name;
    }

    // 2. 캐시된 이름 확인 (Unknown 방지)
    if (state.settings.characterNames && state.settings.characterNames[key]) {
        return state.settings.characterNames[key];
    }

    // 3. 찾을 수 없음
    return 'Unknown';
}

export function getTotalHighlightsForCharacter(charId) {
    const chats = state.settings.highlights[charId];
    if (!chats) return 0;

    return Object.values(chats).reduce((total, chatData) => {
        return total + (chatData.highlights?.length || 0);
    }, 0);
}

/**
 * 이미지를 8×8 캔버스로 축소하여 픽셀 데이터 추출 (기본 아바타 비교용)
 */
export function getImagePixels(img) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 8, 8);
        return ctx.getImageData(0, 0, 8, 8).data;
    } catch (e) {
        return null;
    }
}

/**
 * 기본 아바타(ai4.png) 지문을 미리 로드·캐시
 */
export function initDefaultAvatarDetection() {
    state.defaultAvatarReady = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            state.defaultAvatarPixels = getImagePixels(img);
            resolve();
        };
        img.onerror = () => resolve();
        img.src = '/img/ai4.png';
    });
}

/**
 * 로드된 이미지가 기본 아바타(ai4.png)인지 판별
 */
export function isDefaultAvatarImage(img) {
    if (!state.defaultAvatarPixels) return false;
    const pixels = getImagePixels(img);
    if (!pixels) return false;
    let totalDiff = 0;
    const len = pixels.length;
    for (let i = 0; i < len; i += 4) {
        totalDiff += Math.abs(pixels[i] - state.defaultAvatarPixels[i]);
        totalDiff += Math.abs(pixels[i + 1] - state.defaultAvatarPixels[i + 1]);
        totalDiff += Math.abs(pixels[i + 2] - state.defaultAvatarPixels[i + 2]);
    }
    const avgDiff = totalDiff / (len / 4 * 3);
    return avgDiff < 15;
}

// 캐릭터 정보 캐시 초기화
export function initCharacterCache() {
    state.characterCache = {};
    const charIds = Object.keys(state.settings.highlights);
    for (const charId of charIds) {
        const charData = findCharacterByKey(charId);
        if (charData) {
            state.characterCache[charId] = `${charData.name}|${charData.avatar}`;
        }
    }
}
