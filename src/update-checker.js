// update-checker.js — GitHub에서 최신 버전 확인 및 알림
// compareVersions, checkForUpdates, showUpdateNotification

import { state } from './state.js';
import { GITHUB_REPO, UPDATE_CHECK_CACHE_KEY, UPDATE_CHECK_INTERVAL } from './constants.js';

// ====================================
// 버전 비교
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

// ====================================
// 업데이트 체크
// ====================================

// GitHub에서 최신 버전 확인
export async function checkForUpdates(forceCheck = false) {
    try {
        // 강제 체크가 아닌 경우에만 캐시 확인
        if (!forceCheck) {
            // 세션 캐시 확인 (같은 세션 내에서는 한 번만 체크)
            const sessionCached = sessionStorage.getItem(UPDATE_CHECK_CACHE_KEY);
            if (sessionCached) {
                const sessionData = JSON.parse(sessionCached);
                console.log('[SillyTavern-Highlighter] Using session cached update check');
                // ⭐ 캐시된 버전과 현재 버전 비교 (업데이트 후 캐시 무효화)
                const comparison = compareVersions(sessionData.latestVersion, state.EXTENSION_VERSION);
                return comparison > 0 ?
                    { version: sessionData.latestVersion, updateMessage: sessionData.updateMessage || '' } :
                    { version: null, updateMessage: sessionData.updateMessage || '' };
            }

            // localStorage 캐시 확인 (24시간마다만 체크)
            const cached = localStorage.getItem(UPDATE_CHECK_CACHE_KEY);
            if (cached) {
                const cacheData = JSON.parse(cached);
                const now = Date.now();

                if (now - cacheData.timestamp < UPDATE_CHECK_INTERVAL) {
                    console.log('[SillyTavern-Highlighter] Using localStorage cached update check');
                    // ⭐ 캐시된 버전과 현재 버전 비교 (업데이트 후 캐시 무효화)
                    const comparison = compareVersions(cacheData.latestVersion, state.EXTENSION_VERSION);
                    const hasUpdate = comparison > 0;
                    // sessionStorage에도 저장 (세션 내 중복 체크 방지)
                    sessionStorage.setItem(UPDATE_CHECK_CACHE_KEY, JSON.stringify(cacheData));
                    return hasUpdate ?
                        { version: cacheData.latestVersion, updateMessage: cacheData.updateMessage || '' } :
                        { version: null, updateMessage: cacheData.updateMessage || '' };
                }
            }
        }

        console.log('[SillyTavern-Highlighter] Checking for updates...');

        // GitHub raw URL로 manifest.json 가져오기 (master 브랜치만 사용)
        const timestamp = Date.now(); // 캐시 무효화용 타임스탬프
        const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/master/manifest.json?t=${timestamp}`;

        let remoteManifest = null;

        try {
            // 쿼리 파라미터로 캐시 우회하므로 헤더는 최소화 (CORS 오류 방지)
            const response = await fetch(url, {
                cache: 'no-store'
            });

            if (response.ok) {
                remoteManifest = await response.json();
            } else {
                console.warn(`[SillyTavern-Highlighter] Failed to fetch: HTTP ${response.status}`);
            }
        } catch (err) {
            console.warn(`[SillyTavern-Highlighter] Failed to fetch from ${url}:`, err);
        }

        if (!remoteManifest || !remoteManifest.version) {
            console.warn('[SillyTavern-Highlighter] Could not fetch remote version');
            return null;
        }

        const latestVersion = remoteManifest.version;
        const currentVersion = state.EXTENSION_VERSION;

        console.log(`[SillyTavern-Highlighter] Current: ${currentVersion}, Latest: ${latestVersion}`);

        const comparison = compareVersions(latestVersion, currentVersion);
        const hasUpdate = comparison > 0;

        // 캐시 데이터
        const cacheData = {
            timestamp: Date.now(),
            latestVersion: latestVersion,
            updateMessage: remoteManifest.updateMessage || '',
            hasUpdate: hasUpdate
        };

        // localStorage에 저장 (24시간 캐시)
        localStorage.setItem(UPDATE_CHECK_CACHE_KEY, JSON.stringify(cacheData));

        // sessionStorage에도 저장 (세션 내 중복 체크 방지)
        sessionStorage.setItem(UPDATE_CHECK_CACHE_KEY, JSON.stringify(cacheData));

        if (hasUpdate) {
            console.log(`[SillyTavern-Highlighter] ✨ Update available: ${latestVersion}`);
            return { version: latestVersion, updateMessage: remoteManifest.updateMessage || '' };
        } else {
            console.log('[SillyTavern-Highlighter] You are up to date!');
            return { version: null, updateMessage: remoteManifest.updateMessage || '' };
        }

    } catch (error) {
        console.warn('[SillyTavern-Highlighter] Update check failed:', error);
        return null; // 오류 시 조용히 실패
    }
}

// ====================================
// 업데이트 알림 UI
// ====================================

// 업데이트 알림 표시
export function showUpdateNotification(latestVersion) {
    try {
        // 버전 저장 (나중에 다시 시도하기 위해)
        state.pendingUpdateVersion = latestVersion;

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

            state.pendingUpdateVersion = null; // 성공했으면 초기화
        } else {
            console.log('[SillyTavern-Highlighter] Settings panel not ready, will retry later');
        }
    } catch (error) {
        console.warn('[SillyTavern-Highlighter] Failed to show update notification:', error);
    }
}
