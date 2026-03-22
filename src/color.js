import { state } from './state.js';
import { DEFAULT_COLORS } from './constants.js';
import { hexToRgba, batchUnwrapHighlights } from './utils.js';
import { saveSettingsDebounced } from '../../../../../script.js';

// 순환 참조 방지: restoreHighlightsInChat(highlight-dom)과 renderView(ui-render)는
// 나중에 분리될 모듈이므로 콜백으로 주입받음
let _restoreHighlightsInChat = null;
let _renderView = null;

/**
 * color.js에서 사용할 콜백 등록
 * index.js 초기화 시 호출
 */
export function initColorCallbacks(restoreFn, renderFn) {
    _restoreHighlightsInChat = restoreFn;
    _renderView = renderFn;
}

export function getColors() {
    return state.settings.customColors || DEFAULT_COLORS;
}

export function getColorIndex(color) {
    const colors = getColors();
    for (let i = 0; i < colors.length; i++) {
        if (colors[i].bg === color) {
            return i;
        }
    }
    return undefined;
}

export function switchPreset(presetIndex) {
    if (!state.settings.colorPresets || !state.settings.colorPresets[presetIndex]) {
        console.error('[SillyTavern-Highlighter] Invalid preset index:', presetIndex);
        return;
    }

    const oldPresetIndex = state.settings.currentPresetIndex;
    const oldColors = state.settings.colorPresets[oldPresetIndex].colors;
    const newColors = state.settings.colorPresets[presetIndex].colors;

    console.log('[DEBUG] Switching preset:', {
        from: oldPresetIndex,
        to: presetIndex,
        oldColors: oldColors.map(c => c.bg),
        newColors: newColors.map(c => c.bg)
    });

    // 색상 매핑 테이블 생성 (이전 프리셋 hex -> colorIndex 추출용)
    const colorToIndexMap = {};
    oldColors.forEach((oldColor, index) => {
        colorToIndexMap[oldColor.bg] = index;
    });

    // 새 프리셋의 색상 -> 인덱스 맵 생성 (colorIndex 업데이트용)
    const newColorToIndexMap = {};
    newColors.forEach((newColor, index) => {
        newColorToIndexMap[newColor.bg] = index;
    });

    // 모든 하이라이트의 색상을 새 프리셋으로 매핑
    for (const charId in state.settings.highlights) {
        for (const chatFile in state.settings.highlights[charId]) {
            const chatData = state.settings.highlights[charId][chatFile];
            if (chatData && chatData.highlights) {
                chatData.highlights.forEach(hl => {
                    const oldColor = hl.color;
                    const savedColorIndex = hl.colorIndex;

                    // ✅ 현재 색상이 현재(old) 프리셋에서 실제로 몇 번 인덱스인지 찾기
                    const actualOldIndex = colorToIndexMap[hl.color];

                    if (actualOldIndex !== undefined) {
                        // 같은 인덱스 위치의 새 프리셋 색상으로 매핑
                        const newColor = newColors[actualOldIndex].bg;
                        hl.color = newColor;

                        // 새 색상이 새 프리셋에서 몇 번 인덱스인지 찾아서 저장
                        const actualNewIndex = newColorToIndexMap[newColor];
                        if (actualNewIndex !== undefined) {
                            hl.colorIndex = actualNewIndex;
                        }

                        console.log('[DEBUG] Color mapping:', {
                            hlId: hl.id,
                            oldColor,
                            savedColorIndex,
                            actualOldIndex,
                            newColor: hl.color,
                            newColorIndex: hl.colorIndex
                        });
                    } else {
                        console.warn('[DEBUG] Color not found in old preset:', hl.color);
                    }
                });
            }
        }
    }

    // 현재 프리셋 인덱스 업데이트
    state.settings.currentPresetIndex = presetIndex;

    // customColors를 새 프리셋의 colors로 업데이트 (하위 호환성)
    state.settings.customColors = state.settings.colorPresets[presetIndex].colors;

    // UI 새로고침
    initColorCustomizer();
    updateDynamicColorStyles();

    // 채팅 내 모든 하이라이트 다시 그리기
    batchUnwrapHighlights();
    _restoreHighlightsInChat?.();

    // 패널이 열려있으면 새로고침
    if ($('#highlighter-panel').hasClass('visible')) {
        _renderView?.();
    }

    saveSettingsDebounced();
    toastr.success(`${state.settings.colorPresets[presetIndex].name}(으)로 전환되었습니다`);
}

export function initColorCustomizer() {
    const $container = $('#hl-color-customizer');
    $container.empty();

    const presets = state.settings.colorPresets;
    const currentIndex = state.settings.currentPresetIndex || 0;

    // 선택된 프리셋 초기화 (현재 활성 프리셋)
    if (state.selectedPresetIndex === null) {
        state.selectedPresetIndex = currentIndex;
    }

    // 탭 네비게이션 생성
    let tabsHtml = '<div class="hl-preset-tabs">';
    presets.forEach((preset, index) => {
        const isActive = index === currentIndex;
        const isSelected = index === state.selectedPresetIndex;
        const fontWeight = isActive ? '600' : '500';
        tabsHtml += `
            <div class="hl-preset-tab ${isActive ? 'active' : ''} ${isSelected && !isActive ? 'selected' : ''}" data-preset-index="${index}">
                <span class="hl-preset-tab-name" style="font-size: 13px !important; font-weight: ${fontWeight} !important; font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif !important; line-height: 1.4rem !important; -webkit-text-stroke: 0 !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${preset.name}">${preset.name}</span>
            </div>
        `;
    });
    tabsHtml += '</div>';

    $container.append(tabsHtml);

    // 선택된 프리셋의 색상 표시 (편집 가능)
    const selectedPreset = presets[state.selectedPresetIndex];
    const colors = selectedPreset.colors;
    const isDefaultPreset = selectedPreset.isDefault;

    // 프리셋 관리 버튼
    const showApplyBtn = state.selectedPresetIndex !== currentIndex;
    const presetControlHtml = `
        <div class="hl-preset-controls">
            <div class="hl-preset-title" title="${selectedPreset.name}">${selectedPreset.name}</div>
            <div class="hl-preset-buttons">
                ${showApplyBtn ? '<button class="hl-preset-apply-btn" title="선택한 프리셋을 채팅에 적용"><i class="fa-solid fa-check"></i> 적용</button>' : ''}
                ${!isDefaultPreset ? '<button class="hl-preset-rename-btn" title="프리셋 이름 변경"><i class="fa-solid fa-pencil"></i> 이름 변경</button>' : ''}
            </div>
        </div>
        ${!isDefaultPreset ? `
        <div class="hl-quick-color-input">
            <div class="hl-quick-color-header">
                <label>빠른 색상 적용</label>
                <button class="hl-quick-color-apply-btn">적용</button>
            </div>
            <input type="text" class="hl-quick-color-field" placeholder="#FAEECB #F0E6AE #EEF1E2 #F1D2C6 #BAD7D0" value="${colors.map(c => c.bg.substring(1)).join(' ')}">
            <small class="hl-quick-color-hint">5개의 HEX 색상 코드를 띄어쓰기로 구분<br>(#을 붙여도 입력 가능)</small>
        </div>
        ` : ''}
    `;
    $container.append(presetControlHtml);

    colors.forEach((colorConfig, index) => {
        const previewBg = hexToRgba(colorConfig.bg, colorConfig.opacity);
        const textColor = colorConfig.useDefaultTextColor ? '' : colorConfig.textColor;

        const item = `
            <div class="hl-color-item" data-index="${index}">
                <div class="hl-color-preview">
                    <div class="hl-color-preview-text"><span class="hl-preview-highlight" style="background-color: ${previewBg};${textColor ? ' color: ' + textColor + ';' : ''}">가나다라마바사</span></div>
                </div>
                <div class="hl-color-controls">
                    ${!isDefaultPreset ? `
                    <div class="hl-color-control-row">
                        <label>배경색:</label>
                        <input type="color" class="hl-bg-color" value="${colorConfig.bg}">
                        <div style="display: flex; align-items: center; margin-left: 4px;">
                            <span style="margin-right: 4px;">#</span>
                            <input type="text" class="hl-hex-input" value="${colorConfig.bg.substring(1)}" maxlength="6">
                        </div>
                    </div>
                    ` : ''}
                    <div class="hl-color-control-row">
                        <label>불투명도:</label>
                        <input type="range" class="hl-opacity" min="0" max="100" value="${Math.round(colorConfig.opacity * 100)}">
                        <input type="number" class="hl-opacity-input" min="0" max="100" value="${Math.round(colorConfig.opacity * 100)}">
                        <span>%</span>
                    </div>
                    ${!isDefaultPreset ? `
                    <div class="hl-color-control-row">
                        <label>글자색:</label>
                        <input type="color" class="hl-text-color" value="${colorConfig.textColor}" ${colorConfig.useDefaultTextColor ? 'disabled' : ''}>
                        <label class="hl-use-default-label">
                            <input type="checkbox" class="hl-use-default" ${colorConfig.useDefaultTextColor ? 'checked' : ''}>
                            <span class="hl-checkbox-text">원래 색상 사용</span>
                        </label>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;

        $container.append(item);
    });

    bindColorCustomizerEvents();
    updatePreviewBackground();
}

/**
 * 색상 프리뷰의 배경을 실제 메시지 영역 배경색과 동일하게 설정,
 * 텍스트 색상도 실제 메시지 영역 텍스트 색상으로 설정
 */
export function updatePreviewBackground() {
    const $mesText = $('#chat .mes .mes_text').first();
    let bgColor = '';
    let textColor = '';

    if ($mesText.length) {
        const computed = window.getComputedStyle($mesText[0]);
        bgColor = computed.backgroundColor;
        textColor = computed.color;
    }

    if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
        const $mes = $('#chat .mes').first();
        if ($mes.length) {
            bgColor = window.getComputedStyle($mes[0]).backgroundColor;
        }
    }

    // 채팅 메시지가 없으면 ST 테마 CSS 변수에서 가져오기
    const rootStyle = getComputedStyle(document.documentElement);

    if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
        bgColor = rootStyle.getPropertyValue('--SmartThemeBlurTintColor').trim() || '';
    }

    if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
        bgColor = state.settings.darkMode ? '#1e1e1e' : '#ffffff';
    }

    if (!textColor || textColor === 'rgba(0, 0, 0, 0)') {
        textColor = rootStyle.getPropertyValue('--SmartThemeBodyColor').trim() || '';
    }

    if (!textColor || textColor === 'rgba(0, 0, 0, 0)') {
        textColor = state.settings.darkMode ? '#ccc' : '#333';
    }

    $('.hl-color-preview').css('background-color', bgColor);
    // 기본 텍스트 색상 설정 (useDefaultTextColor일 때 사용)
    $('.hl-color-preview-text').css('color', textColor);
}

export function bindColorCustomizerEvents() {
    // 기존 이벤트 제거 (중복 방지)
    $('.hl-bg-color').off('input');
    $('.hl-opacity').off('input');
    $('.hl-opacity-input').off('input');
    $('.hl-text-color').off('input');
    $('.hl-use-default').off('change');
    $('.hl-hex-input').off('input');
    $('.hl-preset-tab').off('click');
    $('.hl-preset-apply-btn').off('click');
    $('.hl-preset-rename-btn').off('click');
    $('.hl-quick-color-apply-btn').off('click');

    // 프리셋 탭 클릭 이벤트 (선택만, 적용은 X)
    $('.hl-preset-tab').on('click', function () {
        const presetIndex = $(this).data('preset-index');
        if (presetIndex !== state.selectedPresetIndex) {
            state.selectedPresetIndex = presetIndex;
            // UI만 업데이트 (탭 강조 + 적용 버튼 표시)
            initColorCustomizer();
        }
    });

    // 프리셋 적용 버튼
    $('.hl-preset-apply-btn').on('click', function () {
        if (state.selectedPresetIndex !== state.settings.currentPresetIndex) {
            switchPreset(state.selectedPresetIndex);
            // 적용 후 선택 상태 초기화
            state.selectedPresetIndex = state.settings.currentPresetIndex;
        }
    });

    // 프리셋 이름 변경 버튼
    $('.hl-preset-rename-btn').on('click', function () {
        const preset = state.settings.colorPresets[state.selectedPresetIndex];
        const currentName = preset.name;

        const newName = prompt('프리셋 이름을 입력하세요:', currentName);
        if (newName && newName.trim() !== '' && newName !== currentName) {
            preset.name = newName.trim();
            // 탭 이름 업데이트
            $(`.hl-preset-tab[data-preset-index="${state.selectedPresetIndex}"] .hl-preset-tab-name`).text(newName.trim());
            saveSettingsDebounced();
            toastr.success('프리셋 이름이 변경되었습니다');
        }
    });

    // 빠른 색상 적용 버튼
    $('.hl-quick-color-apply-btn').on('click', function () {
        const input = $('.hl-quick-color-field').val().trim();
        if (!input) {
            toastr.warning('색상 코드를 입력해주세요');
            return;
        }

        // 띄어쓰기로 분리
        const colorCodes = input.split(/\s+/).filter(code => code.length > 0);

        if (colorCodes.length !== 5) {
            toastr.error('정확히 5개의 색상 코드를 입력해주세요');
            return;
        }

        // 각 색상 코드 검증 및 변환
        const hexColors = [];
        for (let i = 0; i < colorCodes.length; i++) {
            let code = colorCodes[i].replace(/^#/, ''); // # 제거

            // 유효성 검사 (6자리 hex)
            if (!/^[0-9A-Fa-f]{6}$/.test(code)) {
                toastr.error(`잘못된 색상 코드: ${colorCodes[i]}`);
                return;
            }

            hexColors.push('#' + code.toUpperCase());
        }

        // 색상 적용
        const selectedColors = state.settings.colorPresets[state.selectedPresetIndex].colors;
        const oldColors = selectedColors.map(c => c.bg);

        hexColors.forEach((hexColor, index) => {
            selectedColors[index].bg = hexColor;
        });

        // 선택된 프리셋이 현재 활성 프리셋이면 하이라이트도 업데이트
        if (state.selectedPresetIndex === state.settings.currentPresetIndex) {
            hexColors.forEach((hexColor, index) => {
                state.settings.customColors[index].bg = hexColor;
                updateAllHighlightColors(oldColors[index], hexColor);
            });
            updateDynamicColorStyles();
        }

        // UI 새로고침
        initColorCustomizer();
        saveSettingsDebounced();
        toastr.success('색상이 적용되었습니다');
    });

    $('.hl-bg-color').on('input', function () {
        const $item = $(this).closest('.hl-color-item');
        const index = $item.data('index');
        const selectedColors = state.settings.colorPresets[state.selectedPresetIndex].colors;
        const oldColor = selectedColors[index].bg;
        const newColor = $(this).val();

        // 배경색 업데이트 (선택된 프리셋 수정)
        selectedColors[index].bg = newColor;

        // 헥스 인풋도 업데이트
        $item.find('.hl-hex-input').val(newColor.substring(1));

        // 선택된 프리셋이 현재 활성 프리셋이면 하이라이트도 업데이트
        if (state.selectedPresetIndex === state.settings.currentPresetIndex) {
            state.settings.customColors[index].bg = newColor; // 참조 동기화
            updateAllHighlightColors(oldColor, newColor);
            updateDynamicColorStyles();
        }

        updateColorPreview($item);
        saveSettingsDebounced();
    });

    $('.hl-opacity').on('input', function () {
        const $item = $(this).closest('.hl-color-item');
        const index = $item.data('index');
        const value = parseInt($(this).val());
        const selectedColors = state.settings.colorPresets[state.selectedPresetIndex].colors;

        selectedColors[index].opacity = value / 100;

        $item.find('.hl-opacity-input').val(value);
        updateColorPreview($item);

        // 선택된 프리셋이 현재 활성 프리셋이면 하이라이트도 업데이트
        if (state.selectedPresetIndex === state.settings.currentPresetIndex) {
            state.settings.customColors[index].opacity = value / 100; // 참조 동기화
            updateDynamicColorStyles();

            // 채팅 내 해당 색상의 모든 하이라이트 업데이트
            const color = selectedColors[index].bg;
            $(`.text-highlight[data-color="${color}"]`).each(function () {
                const bgColor = getBackgroundColorFromHex(color);
                $(this).css('background-color', bgColor);
            });
        }

        saveSettingsDebounced();
    });

    $('.hl-opacity-input').on('input', function () {
        const $item = $(this).closest('.hl-color-item');
        const index = $item.data('index');
        let value = parseInt($(this).val());

        // 범위 체크
        if (value < 0) value = 0;
        if (value > 100) value = 100;
        if (isNaN(value)) value = 0;

        const selectedColors = state.settings.colorPresets[state.selectedPresetIndex].colors;
        selectedColors[index].opacity = value / 100;

        const $range = $item.find('.hl-opacity');
        $range.val(value);
        $(this).val(value);
        updateColorPreview($item);

        // 선택된 프리셋이 현재 활성 프리셋이면 하이라이트도 업데이트
        if (state.selectedPresetIndex === state.settings.currentPresetIndex) {
            state.settings.customColors[index].opacity = value / 100; // 참조 동기화
            updateDynamicColorStyles();

            // 채팅 내 해당 색상의 모든 하이라이트 업데이트
            const color = selectedColors[index].bg;
            $(`.text-highlight[data-color="${color}"]`).each(function () {
                const bgColor = getBackgroundColorFromHex(color);
                $(this).css('background-color', bgColor);
            });
        }

        saveSettingsDebounced();
    });

    $('.hl-text-color').on('input', function () {
        const $item = $(this).closest('.hl-color-item');
        const index = $item.data('index');
        const selectedColors = state.settings.colorPresets[state.selectedPresetIndex].colors;

        selectedColors[index].textColor = $(this).val();

        updateColorPreview($item);

        // 선택된 프리셋이 현재 활성 프리셋이면 하이라이트도 업데이트
        if (state.selectedPresetIndex === state.settings.currentPresetIndex) {
            state.settings.customColors[index].textColor = $(this).val(); // 참조 동기화
            updateDynamicColorStyles();
        }

        saveSettingsDebounced();
    });

    $('.hl-use-default').on('change', function () {
        const $item = $(this).closest('.hl-color-item');
        const index = $item.data('index');
        const checked = $(this).is(':checked');
        const selectedColors = state.settings.colorPresets[state.selectedPresetIndex].colors;

        selectedColors[index].useDefaultTextColor = checked;

        $item.find('.hl-text-color').prop('disabled', checked);
        updateColorPreview($item);

        // 선택된 프리셋이 현재 활성 프리셋이면 하이라이트도 업데이트
        if (state.selectedPresetIndex === state.settings.currentPresetIndex) {
            state.settings.customColors[index].useDefaultTextColor = checked; // 참조 동기화
            updateDynamicColorStyles();
        }

        saveSettingsDebounced();
    });

    $('.hl-hex-input').on('input', function () {
        const $item = $(this).closest('.hl-color-item');
        const index = $item.data('index');
        let hexValue = $(this).val().replace(/[^0-9A-Fa-f]/g, ''); // 유효한 문자만 허용

        // 6자리 헥스 코드인 경우에만 색상 업데이트
        if (hexValue.length === 6) {
            const selectedColors = state.settings.colorPresets[state.selectedPresetIndex].colors;
            const oldColor = selectedColors[index].bg;
            const newColor = '#' + hexValue.toUpperCase();

            // 배경색 업데이트 (선택된 프리셋 수정)
            selectedColors[index].bg = newColor;

            // 컬러피커도 업데이트
            $item.find('.hl-bg-color').val(newColor);

            // 선택된 프리셋이 현재 활성 프리셋이면 하이라이트도 업데이트
            if (state.selectedPresetIndex === state.settings.currentPresetIndex) {
                state.settings.customColors[index].bg = newColor; // 참조 동기화
                updateAllHighlightColors(oldColor, newColor);
                updateDynamicColorStyles();
            }

            updateColorPreview($item);
            saveSettingsDebounced();
        } else {
            // 6자리가 아닌 경우 인풋 값만 업데이트 (대문자 변환)
            $(this).val(hexValue.toUpperCase());
        }
    });
}

export function updateColorPreview($item) {
    const index = $item.data('index');
    const colorConfig = state.settings.colorPresets[state.selectedPresetIndex].colors[index];
    const previewBg = hexToRgba(colorConfig.bg, colorConfig.opacity);

    const $highlight = $item.find('.hl-preview-highlight');
    $highlight.css('background-color', previewBg);

    if (colorConfig.useDefaultTextColor) {
        $highlight.css('color', '');
    } else {
        $highlight.css('color', colorConfig.textColor);
    }
}

export function updateDynamicColorStyles() {
    const colors = getColors();
    let styleContent = '';

    colors.forEach((colorConfig) => {
        const rgba = hexToRgba(colorConfig.bg, colorConfig.opacity);
        styleContent += `.text-highlight[data-color="${colorConfig.bg}"] { --hl-bg-color: ${rgba} !important; }\n`;

        if (!colorConfig.useDefaultTextColor) {
            styleContent += `.text-highlight[data-color="${colorConfig.bg}"] { color: ${colorConfig.textColor} !important; }\n`;
        }
    });

    // 기존 style 요소 재사용 (삭제/재생성 대신 textContent만 갱신)
    let styleEl = document.getElementById('hl-dynamic-styles');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'hl-dynamic-styles';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = styleContent;
}

export function updateAllHighlightColors(oldColor, newColor) {
    // 모든 캐릭터의 모든 채팅의 모든 하이라이트 색상 업데이트
    for (const charId in state.settings.highlights) {
        for (const chatFile in state.settings.highlights[charId]) {
            const chatData = state.settings.highlights[charId][chatFile];
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
    const bgColor = getBackgroundColorFromHex(newColor);
    document.querySelectorAll(`.text-highlight[data-color="${CSS.escape(oldColor)}"]`).forEach(el => {
        el.setAttribute('data-color', newColor);
        el.style.backgroundColor = bgColor;
    });

    // 패널이 열려있으면 새로고침
    if ($('#highlighter-panel').hasClass('visible')) {
        _renderView?.();
    }
}

export function exportColors() {
    const currentPreset = state.settings.colorPresets[state.settings.currentPresetIndex];
    const data = {
        version: '2.0',
        presetName: currentPreset.name,
        colors: currentPreset.colors
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `highlighter_preset_${currentPreset.name}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toastr.success(`${currentPreset.name} 프리셋이 백업되었습니다`);
}

export function importColors(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (event) {
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

            const currentIndex = state.settings.currentPresetIndex;
            const currentPreset = state.settings.colorPresets[currentIndex];

            // 기본 프리셋은 불러오기 불가
            if (currentPreset.isDefault) {
                toastr.warning('기본 프리셋은 색상을 불러올 수 없습니다. 다른 프리셋을 선택해주세요.');
                $(e.target).val('');
                return;
            }

            // 기존 색상 -> 인덱스 매핑
            const oldColors = currentPreset.colors.map(c => c.bg);

            // 현재 프리셋의 색상 업데이트
            currentPreset.colors = data.colors;
            state.settings.customColors = data.colors;

            initColorCustomizer();
            updateDynamicColorStyles();

            // 각 하이라이트의 색상을 새 팔레트로 업데이트
            for (const charId in state.settings.highlights) {
                for (const chatFile in state.settings.highlights[charId]) {
                    const chatData = state.settings.highlights[charId][chatFile];
                    if (chatData && chatData.highlights) {
                        chatData.highlights.forEach(hl => {
                            const oldIndex = oldColors.indexOf(hl.color);
                            if (oldIndex !== -1) {
                                hl.color = state.settings.customColors[oldIndex].bg;
                            } else {
                                // 색상을 찾지 못한 경우 첫 번째 색상으로 폴백
                                hl.color = state.settings.customColors[0].bg;
                            }
                        });
                    }
                }
            }

            // 채팅 내 모든 하이라이트 제거하고 다시 그리기
            batchUnwrapHighlights();

            _renderView?.(); // 패널에 바뀐 색상 적용
            _restoreHighlightsInChat?.(); // 새 색상으로 다시 그리기
            saveSettingsDebounced();
            toastr.success(`${currentPreset.name}에 색상을 불러왔습니다`);
        } catch (error) {
            toastr.error('색상 설정 불러오기 실패: ' + error.message);
        }
    };
    reader.readAsText(file);

    // 파일 입력 초기화
    $(e.target).val('');
}

// 16진수 색상 코드를 투명도가 적용된 rgba로 변환
export function getBackgroundColorFromHex(hex) {
    const colors = getColors();
    const colorConfig = colors.find(c => c.bg === hex);

    if (colorConfig) {
        return hexToRgba(colorConfig.bg, colorConfig.opacity);
    }

    // 기본값
    return hexToRgba('#FFE4B5', 0.8);
}
