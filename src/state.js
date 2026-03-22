import { VIEW_LEVELS } from './constants.js';

// ====================================
// 전역 상태 관리
// ====================================
// 모든 뮤터블 전역 상태를 하나의 객체로 관리합니다.
// state.xxx 형태로 접근하면 어디서 상태를 읽고/쓰는지 grep으로 즉시 추적 가능합니다.

export const state = {
    // 앱 버전 (manifest.json 로드 전 기본값)
    EXTENSION_VERSION: '1.0.0',

    // 설정 (초기화 시 extension_settings에서 로드)
    settings: null,

    // 뷰 상태
    currentView: VIEW_LEVELS.CHARACTER_LIST,
    selectedCharacter: null,
    selectedChat: null,
    searchQuery: '',
    searchCategory: 'all', // 'all' | 'character' | 'chat' | 'highlight' | 'note'
    viewScrollPositions: {}, // 뷰별 스크롤 위치 { 'CHARACTER_LIST': 0, 'CHAT_LIST:charKey': 120, ... }
    panelContentDirty: true,  // 패널 콘텐츠 재렌더링 필요 여부
    selectMode: false,         // 선택 삭제 모드

    // 형광펜 모드
    isHighlightMode: false,

    // 패널 드래그
    isDragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,

    // 채팅 변경 감지
    previousChatFile: null,        // 채팅 제목 변경 감지용
    previousCharId: null,          // 캐릭터/그룹 변경 감지용 (getCurrentCharacterKey() 기반)
    previousChatLength: null,      // 채팅 메시지 개수 (같은 채팅인지 확인용)
    previousChatChangeTime: null,  // 채팅 변경 시간 (제목 변경과 채팅 이동 구분용)
    previousChatMessages: null,    // 첫/마지막 메시지 저장 (제목 변경 검증용)

    // 채팅 이름 변경 직접 감지용 (renameChatButton 클릭 가로채기)
    pendingRename: null, // { charId, oldChatFile, timestamp }

    // 타이머 / 핸들러
    highlightRestoreTimer: null,   // 형광펜 복원 디바운스 타이머
    chatObserver: null,            // MutationObserver 인스턴스
    touchSelectionTimer: null,     // 모바일 터치 이벤트 안정화
    lastTouchEnd: 0,
    selectionChangeTimer: null,    // Android용 selectionchange 디바운싱 타이머
    isPointerDown: false,          // 드래그 중 툴팁 억제용 플래그
    colorMenuDocClickHandler: null,

    // 캐릭터 캐시
    characterCache: {},
    defaultAvatarPixels: null, // 기본 아바타(ai4.png) 감지용 픽셀 지문
    defaultAvatarReady: null,  // 기본 아바타 지문 로드 완료 Promise

    // 색상 커스터마이저
    selectedPresetIndex: null, // 선택된 프리셋 인덱스 (적용 전)

    // 업데이트
    pendingUpdateVersion: null, // DOM 준비 전에도 버전 저장
};
