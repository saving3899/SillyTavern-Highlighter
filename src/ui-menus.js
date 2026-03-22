import { saveSettingsDebounced } from '../../../../../script.js';
import { state } from './state.js';
import { VIEW_LEVELS } from './constants.js';
import { batchUnwrapHighlights } from './utils.js';
import { getCharacterNameByKey } from './character-keys.js';
import { getColors } from './color.js';
import { deleteBookmark } from './bookmark.js';
import { findHighlightById, deleteHighlight, changeHighlightColor, deleteCharacterHighlights, deleteChatHighlights } from './highlight-crud.js';
import { showTranslatorEditModal } from './highlight-dom.js';
import { getDarkModeClass, toggleDarkMode, openPanel } from './ui-panel.js';
import { renderView, updateTabCounts, getActiveTab, navigateToHighlightList } from './ui-render.js';

// 순환 참조 방지용 콜백
let _exportHighlights = null;
let _repairOrphanedData = null;

/**
 * 열려있는 모든 드롭다운 메뉴를 닫는다 (자기 메뉴 제외)
 * @param {string} [exceptId] 제외할 메뉴 ID (# 포함)
 */
function closeAllMenus(exceptId) {
    const menuIds = [
        '#hl-bookmark-more-menu',
        '#hl-item-more-menu',
        '#hl-breadcrumb-more-menu',
        '#hl-header-more-menu',
        '#highlight-context-menu',
    ];
    menuIds.forEach(id => {
        if (id !== exceptId) $(id).remove();
    });
}

export function initUiMenusCallbacks(exportHighlightsFn, repairOrphanedDataFn) {
    _exportHighlights = exportHighlightsFn;
    _repairOrphanedData = repairOrphanedDataFn;
}

// ====================================
// 캐릭터/채팅 메모 에디터
// ====================================

export function openCharacterMemoEditor(charKey) {
    $('#character-memo-modal').remove();

    const charName = getCharacterNameByKey(charKey);
    const currentMemo = state.settings.characterMemos?.[charKey] || '';

    const modal = `
        <div id="character-memo-modal" class="hl-modal-overlay">
            <div class="hl-modal ${getDarkModeClass()}">
                <div class="hl-modal-header">
                    <h3><i class="fa-solid fa-pencil"></i> 캐릭터 메모</h3>
                    <button class="hl-modal-close"><i class="fa-solid fa-times"></i></button>
                </div>
                <div class="hl-modal-body">
                    <div class="hl-memo-modal-info">
                        <span>${charName}</span>
                    </div>
                    <textarea class="hl-note-textarea" placeholder="이 캐릭터를 구분하기 위한 메모를 입력하세요
예: 페르소나 A, 친구 설정, 연인 루트 등">${currentMemo}</textarea>
                    <small style="display: block; margin-top: 8px; color: #777;">
                        같은 이름의 캐릭터를 구분하는 데 도움이 됩니다.
                    </small>
                </div>
                <div class="hl-modal-footer">
                    <button class="hl-modal-btn hl-modal-cancel">취소</button>
                    ${currentMemo ? '<button class="hl-modal-btn hl-modal-delete">삭제</button>' : ''}
                    <button class="hl-modal-btn hl-modal-save">저장</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modal);

    const $textarea = $('.hl-note-textarea');
    $textarea.focus();

    // 저장 버튼
    $('.hl-modal-save').on('click', function () {
        const newMemo = $textarea.val().trim();
        if (!state.settings.characterMemos) state.settings.characterMemos = {};

        if (newMemo) {
            state.settings.characterMemos[charKey] = newMemo;
        } else {
            delete state.settings.characterMemos[charKey];
        }

        saveSettingsDebounced();
        renderView();
        $('#character-memo-modal').remove();
        toastr.success('메모 저장됨');
    });

    // 삭제 버튼
    $('.hl-modal-delete').on('click', function () {
        if (confirm('메모를 삭제하시겠습니까?')) {
            if (state.settings.characterMemos) {
                delete state.settings.characterMemos[charKey];
            }
            saveSettingsDebounced();
            renderView();
            $('#character-memo-modal').remove();
            toastr.info('메모 삭제됨');
        }
    });

    // 닫기/취소 버튼
    const closeMemoModal = function () {
        const newMemo = $textarea.val().trim();
        const hasChanges = newMemo !== currentMemo;

        if (hasChanges && newMemo.length > 0) {
            if (confirm('메모를 취소하시겠습니까?\n저장되지 않은 변경사항이 사라집니다.')) {
                $('#character-memo-modal').remove();
            }
        } else {
            $('#character-memo-modal').remove();
        }
    };

    $('.hl-modal-close, .hl-modal-cancel').on('click', closeMemoModal);

    // 모달 밖 클릭 시 닫기
    $('.hl-modal-overlay').on('click', function (e) {
        if (e.target === this) {
            closeMemoModal();
        }
    });
}

export function openChatMemoEditor(charId, chatFile) {
    $('#chat-memo-modal').remove();

    const charName = getCharacterNameByKey(charId);
    const memoKey = `${charId}_${chatFile}`;
    const currentMemo = state.settings.chatMemos?.[memoKey] || '';

    const modal = `
        <div id="chat-memo-modal" class="hl-modal-overlay">
            <div class="hl-modal ${getDarkModeClass()}">
                <div class="hl-modal-header">
                    <h3><i class="fa-solid fa-pencil"></i> 채팅 메모</h3>
                    <button class="hl-modal-close"><i class="fa-solid fa-times"></i></button>
                </div>
                <div class="hl-modal-body">
                    <div class="hl-memo-modal-info">
                        <span>${charName}</span> <span style="color: #999;">&gt;</span> <span>${chatFile}</span>
                    </div>
                    <textarea class="hl-note-textarea" placeholder="이 채팅을 구분하기 위한 메모를 입력하세요
예: 1차 대화, 친구 루트, 연인 루트 등">${currentMemo}</textarea>
                    <small style="display: block; margin-top: 8px; color: #777;">
                        같은 캐릭터의 여러 채팅을 구분하는 데 도움이 됩니다.
                    </small>
                </div>
                <div class="hl-modal-footer">
                    <button class="hl-modal-btn hl-modal-cancel">취소</button>
                    ${currentMemo ? '<button class="hl-modal-btn hl-modal-delete">삭제</button>' : ''}
                    <button class="hl-modal-btn hl-modal-save">저장</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modal);

    const $textarea = $('.hl-note-textarea');
    $textarea.focus();

    // 저장 버튼
    $('.hl-modal-save').on('click', function () {
        const newMemo = $textarea.val().trim();
        if (!state.settings.chatMemos) state.settings.chatMemos = {};

        if (newMemo) {
            state.settings.chatMemos[memoKey] = newMemo;
        } else {
            delete state.settings.chatMemos[memoKey];
        }

        saveSettingsDebounced();
        renderView();
        $('#chat-memo-modal').remove();
        toastr.success('메모 저장됨');
    });

    // 삭제 버튼
    $('.hl-modal-delete').on('click', function () {
        if (confirm('메모를 삭제하시겠습니까?')) {
            if (state.settings.chatMemos) {
                delete state.settings.chatMemos[memoKey];
            }
            saveSettingsDebounced();
            renderView();
            $('#chat-memo-modal').remove();
            toastr.info('메모 삭제됨');
        }
    });

    // 닫기/취소 버튼
    const closeChatMemoModal = function () {
        const newMemo = $textarea.val().trim();
        const hasChanges = newMemo !== currentMemo;

        if (hasChanges && newMemo.length > 0) {
            if (confirm('메모를 취소하시겠습니까?\n저장되지 않은 변경사항이 사라집니다.')) {
                $('#chat-memo-modal').remove();
            }
        } else {
            $('#chat-memo-modal').remove();
        }
    };

    $('.hl-modal-close, .hl-modal-cancel').on('click', closeChatMemoModal);

    // 모달 밖 클릭 시 닫기
    $('.hl-modal-overlay').on('click', function (e) {
        if (e.target === this) {
            closeChatMemoModal();
        }
    });
}

// ====================================
// 형광펜 컨텍스트 메뉴 (우클릭/길게누르기)
// ====================================

export function showHighlightContextMenu(hlId, x, y) {
    const result = findHighlightById(hlId);
    if (!result) {
        console.warn('[SillyTavern-Highlighter] Highlight not found:', hlId);
        return;
    }

    const hl = result.highlight;

    closeAllMenus();
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
            <button class="hl-context-btn" data-action="open-panel">
                <i class="fa-solid fa-book-open"></i>
                <span>독서노트 열기</span>
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
            case 'open-panel':
                // 패널 열고 현재 채팅의 형광펜 목록으로 이동
                state.selectedCharacter = menuCharId;
                state.selectedChat = menuChatFile;
                navigateToHighlightList(menuCharId, menuChatFile);
                openPanel();
                $('#highlight-context-menu').remove();
                break;
            case 'delete':
                deleteHighlight(menuHlId, menuCharId, menuChatFile);
                $('#highlight-context-menu').remove();
                break;
        }
    });

    // 우클릭 방지
    $menu.on('contextmenu', function (e) {
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

// ====================================
// 메모/복사 모달
// ====================================

export function showNoteModal(hlId, charId, chatFile) {
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
                    <textarea class="hl-note-textarea" placeholder="메모를 입력하세요">${hl.note || ''}</textarea>
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

export function showCopyModal(hlId, charId, chatFile) {
    const result = findHighlightById(hlId);
    if (!result) return;

    const hl = result.highlight;

    // LLM 번역기 호환: 번역문/원문 쌍이 있는지 확인
    const hasPair = state.settings.translatorCompat && hl.sourceType && hl.sourceType !== 'mixed' &&
        ((hl.sourceType === 'translated' && hl.translatorOriginalText) ||
         (hl.sourceType === 'original' && hl.translatedText));

    // 텍스트 조합 함수
    const getTranslatedText = () => hl.sourceType === 'translated' ? hl.text : hl.translatedText;
    const getOriginalText = () => hl.sourceType === 'original' ? hl.text : hl.translatorOriginalText;

    const buildText = (mode) => {
        let t;
        if (!hasPair) {
            t = hl.text;
        } else if (mode === 'translated') {
            t = getTranslatedText();
        } else if (mode === 'original') {
            t = getOriginalText();
        } else {
            // both
            t = `${getTranslatedText()}\n\n${getOriginalText()}`;
        }
        if (hl.note) t += `\n\n메모: ${hl.note}`;
        return t;
    };

    let currentCopyMode = 'both';
    const initialText = hasPair ? buildText('both') : buildText();

    $('#highlight-copy-modal').remove();

    const copyModeLabels = { both: '번역문과 원문', translated: '번역문만', original: '원문만' };

    // 커스텀 드롭다운 (번역문/원문 쌍이 있는 경우만)
    const dropdownHtml = hasPair ? `
        <div class="hl-copy-mode-dropdown">
            <button class="hl-copy-mode-btn" type="button">
                <span class="hl-copy-mode-label">${copyModeLabels[currentCopyMode]}</span>
                <i class="fa-solid fa-chevron-down hl-copy-mode-arrow"></i>
            </button>
            <div class="hl-copy-mode-menu" style="display:none;">
                <div class="hl-copy-mode-item active" data-value="both">번역문과 원문</div>
                <div class="hl-copy-mode-item" data-value="translated">번역문만</div>
                <div class="hl-copy-mode-item" data-value="original">원문만</div>
            </div>
        </div>
    ` : '';

    const modal = `
        <div id="highlight-copy-modal" class="hl-modal-overlay">
            <div class="hl-modal ${getDarkModeClass()}">
                <div class="hl-modal-header">
                    <h3>텍스트 복사</h3>
                    <button class="hl-modal-close">&times;</button>
                </div>
                <div class="hl-modal-body">
                    ${dropdownHtml}
                    <textarea class="hl-copy-textarea" readonly>${initialText}</textarea>
                </div>
                <div class="hl-modal-footer">
                    <button class="hl-modal-btn hl-modal-select">전체 선택</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modal);

    const $modal = $('#highlight-copy-modal');

    // 커스텀 드롭다운 이벤트
    $modal.find('.hl-copy-mode-btn').on('click', function (e) {
        e.stopPropagation();
        const $menu = $modal.find('.hl-copy-mode-menu');
        $menu.toggle();
        $(this).find('.hl-copy-mode-arrow').toggleClass('fa-chevron-down fa-chevron-up');
    });

    $modal.find('.hl-copy-mode-item').on('click', function (e) {
        e.stopPropagation();
        const mode = $(this).data('value');
        currentCopyMode = mode;
        // UI 업데이트
        $modal.find('.hl-copy-mode-label').text(copyModeLabels[mode]);
        $modal.find('.hl-copy-mode-item').removeClass('active');
        $(this).addClass('active');
        $modal.find('.hl-copy-mode-menu').hide();
        $modal.find('.hl-copy-mode-arrow').removeClass('fa-chevron-up').addClass('fa-chevron-down');
        // 텍스트 업데이트
        $modal.find('.hl-copy-textarea').val(buildText(mode)).select();
    });

    // 메뉴 외부 클릭 시 닫기
    $modal.on('click', function (e) {
        if (!$(e.target).closest('.hl-copy-mode-dropdown').length) {
            $modal.find('.hl-copy-mode-menu').hide();
            $modal.find('.hl-copy-mode-arrow').removeClass('fa-chevron-up').addClass('fa-chevron-down');
        }
        if (e.target === this) $modal.remove();
    });

    $modal.find('.hl-modal-select').on('click', function () {
        $modal.find('.hl-copy-textarea').select();
    });

    $modal.find('.hl-modal-close').on('click', function () {
        $modal.remove();
    });

    setTimeout(() => $modal.find('.hl-copy-textarea').select(), 100);
}

// ====================================
// 선택 삭제 모드
// ====================================

export function enterSelectMode() {
    state.selectMode = true;
    const $content = $('#highlighter-content');
    $content.addClass('hl-select-mode');

    // 뷰 레벨에 따라 대상 셀렉터 결정
    const isChatList = state.currentView === VIEW_LEVELS.CHAT_LIST;
    const itemSelector = isChatList
        ? '.hl-list-item'
        : '.hl-highlight-item, .hl-bookmark-item';

    // 각 아이템에 체크박스 추가
    $content.find(itemSelector).each(function () {
        if (!$(this).find('.hl-select-checkbox').length) {
            $(this).prepend('<input type="checkbox" class="hl-select-checkbox">');
        }
    });

    // 선택 툴바 표시
    const toolbar = `
        <div class="hl-select-toolbar">
            <button class="hl-select-toolbar-btn" id="hl-select-all-btn">전체 선택</button>
            <span class="hl-select-count">0개 선택</span>
            <div class="hl-select-toolbar-spacer"></div>
            <button class="hl-select-toolbar-btn hl-select-delete-btn" id="hl-select-delete-btn" disabled>삭제</button>
            <button class="hl-select-toolbar-btn" id="hl-select-cancel-btn">취소</button>
        </div>
    `;
    $content.before(toolbar);

    // 체크박스 변경 이벤트
    $content.on('change.state.selectMode', '.hl-select-checkbox', function () {
        $(this).closest(itemSelector)
            .toggleClass('hl-selected', this.checked);
        updateSelectCount();
    });

    // 아이템 클릭 시 체크박스 토글
    $content.on('click.state.selectMode', itemSelector, function (e) {
        // 체크박스 자체 클릭은 무시 (기본 동작 유지)
        if ($(e.target).hasClass('hl-select-checkbox')) return;
        const $cb = $(this).find('.hl-select-checkbox');
        $cb.prop('checked', !$cb.prop('checked')).trigger('change');
    });

    // 전체 선택
    $('#hl-select-all-btn').on('click', function () {
        const $checkboxes = $content.find('.hl-select-checkbox');
        const allChecked = $checkboxes.length === $checkboxes.filter(':checked').length;
        $checkboxes.prop('checked', !allChecked);
        updateSelectCount();
    });

    // 삭제 실행
    $('#hl-select-delete-btn').on('click', executeSelectDelete);

    // 취소
    $('#hl-select-cancel-btn').on('click', exitSelectMode);
}

export function exitSelectMode() {
    state.selectMode = false;
    const $content = $('#highlighter-content');
    $content.removeClass('hl-select-mode');
    $content.find('.hl-select-checkbox').remove();
    $content.find('.hl-selected').removeClass('hl-selected');
    $content.off('change.state.selectMode');
    $content.off('click.state.selectMode');
    $('.hl-select-toolbar').remove();
}

function updateSelectCount() {
    const count = $('#highlighter-content .hl-select-checkbox:checked').length;
    $('.hl-select-count').text(`${count}개 선택`);
    $('#hl-select-delete-btn').prop('disabled', count === 0);
}

function executeSelectDelete() {
    const $checked = $('#highlighter-content .hl-select-checkbox:checked');
    const count = $checked.length;
    if (count === 0) return;

    if (!confirm(`선택한 ${count}개 항목을 삭제하시겠습니까?`)) return;

    const isChatList = state.currentView === VIEW_LEVELS.CHAT_LIST;

    if (isChatList) {
        // 채팅 목록에서 선택 삭제: 해당 채팅의 형광펜/책갈피/메모 전체 삭제
        $checked.each(function () {
            const $item = $(this).closest('.hl-list-item');
            const chatFile = $item.data('chatFile');
            if (!chatFile || !state.selectedCharacter) return;

            if (state.settings.highlights[state.selectedCharacter]?.[chatFile]) {
                delete state.settings.highlights[state.selectedCharacter][chatFile];
            }
            if (state.settings.bookmarks?.[state.selectedCharacter]?.[chatFile]) {
                delete state.settings.bookmarks[state.selectedCharacter][chatFile];
            }
            const memoKey = `${state.selectedCharacter}_${chatFile}`;
            if (state.settings.chatMemos?.[memoKey]) {
                delete state.settings.chatMemos[memoKey];
            }
        });
    } else {
        // 형광펜/책갈피 개별 삭제
        const hlToDelete = [];
        const bmToDelete = [];

        $checked.each(function () {
            const $item = $(this).closest('.hl-highlight-item, .hl-bookmark-item');
            if ($item.hasClass('hl-highlight-item')) {
                hlToDelete.push({
                    hlId: $item.data('hlId'),
                    chatFile: $item.data('chatFile') || state.selectedChat,
                    charId: state.selectedCharacter,
                });
            } else if ($item.hasClass('hl-bookmark-item')) {
                bmToDelete.push({
                    bmId: $item.data('bmId'),
                    chatFile: $item.data('chatFile') || state.selectedChat,
                    charId: $item.data('charId') || state.selectedCharacter,
                });
            }
        });

        hlToDelete.forEach(({ charId, chatFile, hlId }) => {
            const chatData = state.settings.highlights[charId]?.[chatFile];
            if (!chatData) return;
            chatData.highlights = chatData.highlights.filter(h => h.id !== hlId);
            chatData.lastModified = Date.now();
            batchUnwrapHighlights(`.text-highlight[data-hl-id="${hlId}"]`);
        });

        bmToDelete.forEach(({ charId, chatFile, bmId }) => {
            const chatBM = state.settings.bookmarks?.[charId]?.[chatFile];
            if (!chatBM) return;
            chatBM.bookmarks = chatBM.bookmarks.filter(b => b.id !== bmId);
            chatBM.lastModified = Date.now();
        });
    }

    saveSettingsDebounced();
    exitSelectMode();
    renderView();
    toastr.success(`${count}개 삭제됨`);
}

// ====================================
// 책갈피 더보기 메뉴
// ====================================

export function showBookmarkItemMoreMenu(e) {
    e.stopPropagation();

    const $existingMenu = $('#hl-bookmark-more-menu');
    if ($existingMenu.length) {
        $existingMenu.remove();
        return;
    }
    closeAllMenus('#hl-bookmark-more-menu');

    const $btn = $(e.currentTarget);
    const bmId = $btn.data('bmId');
    const chatFile = $btn.data('chatFile');
    const charId = $btn.data('charId');
    const mesId = $btn.data('mesId');
    const rect = $btn[0].getBoundingClientRect();

    const menuHtml = `
        <div id="hl-bookmark-more-menu" class="hl-more-menu ${getDarkModeClass()}" data-bm-id="${bmId}" data-chat-file="${chatFile}" data-char-id="${charId}" data-mes-id="${mesId}">
            <button class="hl-more-menu-item" data-action="memo">
                <i class="fa-solid fa-pen"></i>
                <span>메모</span>
            </button>
            <button class="hl-more-menu-item hl-menu-danger" data-action="delete">
                <i class="fa-solid fa-trash"></i>
                <span>삭제</span>
            </button>
        </div>
    `;

    $('body').append(menuHtml);

    const $newMenu = $('#hl-bookmark-more-menu');

    const menuRect = $newMenu[0].getBoundingClientRect();
    const menuWidth = menuRect.width;
    const menuHeight = menuRect.height;
    const margin = 8;

    let top = rect.bottom + 4;
    let left = rect.right - menuWidth;

    // 뷰포트 경계 클램핑
    if (left + menuWidth > window.innerWidth - margin) {
        left = window.innerWidth - menuWidth - margin;
    }
    if (left < margin) {
        left = margin;
    }
    if (top + menuHeight > window.innerHeight - margin) {
        top = rect.top - menuHeight - 4;
    }
    if (top < margin) {
        top = margin;
    }

    $newMenu.css({
        position: 'fixed',
        top: top + 'px',
        left: left + 'px',
        zIndex: 100002
    });

    $newMenu.find('.hl-more-menu-item').off('click').on('click', function (e) {
        e.stopPropagation();
        const action = $(this).data('action');
        const menuBmId = $newMenu.data('bmId');
        const menuChatFile = $newMenu.data('chatFile');
        const menuCharId = $newMenu.data('charId');

        switch (action) {
            case 'memo':
                showBookmarkNoteModal(menuCharId, menuChatFile, menuBmId);
                break;
            case 'delete':
                deleteBookmark(menuCharId, menuChatFile, menuBmId);
                renderView();
                updateTabCounts();
                break;
        }

        $newMenu.remove();
    });

    setTimeout(() => {
        $(document).one('click', () => $('#hl-bookmark-more-menu').remove());
    }, 100);
}

// 책갈피 메모 모달
function showBookmarkNoteModal(charId, chatFile, bmId) {
    if (!state.settings.bookmarks?.[charId]?.[chatFile]) return;
    const bmList = state.settings.bookmarks[charId][chatFile].bookmarks;
    const bm = bmList.find(b => b.id === bmId);
    if (!bm) return;

    const currentNote = bm.note || '';

    $('#hl-bookmark-note-modal').remove();

    const modalHtml = `
        <div id="hl-bookmark-note-modal" class="hl-modal-overlay">
            <div class="hl-modal ${getDarkModeClass()}">
                <div class="hl-modal-header">
                    <h3>책갈피 메모 ${currentNote ? '수정' : '입력'}</h3>
                    <button class="hl-modal-close">&times;</button>
                </div>
                <div class="hl-modal-body">
                    <textarea class="hl-note-textarea" placeholder="메모를 입력하세요">${currentNote}</textarea>
                </div>
                <div class="hl-modal-footer">
                    <button class="hl-modal-btn hl-modal-cancel">취소</button>
                    <button class="hl-modal-btn hl-modal-save">저장</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);

    const $textarea = $('#hl-bookmark-note-modal .hl-note-textarea');
    const originalNote = currentNote;
    $textarea.focus();

    // 저장
    $('#hl-bookmark-note-modal .hl-modal-save').on('click', function () {
        bm.note = $textarea.val().trim();
        saveSettingsDebounced();
        $('#hl-bookmark-note-modal').remove();
        renderView();
        toastr.success('책갈피 메모가 저장되었습니다.');
    });

    // 닫기/취소
    const closeModal = function () {
        const current = $textarea.val();
        const hasChanges = current !== originalNote;
        if (hasChanges && current.trim().length > 0) {
            if (confirm('메모를 취소하시겠습니까?\n저장되지 않은 변경사항이 사라집니다.')) {
                $('#hl-bookmark-note-modal').remove();
            }
        } else {
            $('#hl-bookmark-note-modal').remove();
        }
    };

    $('#hl-bookmark-note-modal .hl-modal-close, #hl-bookmark-note-modal .hl-modal-cancel').on('click', closeModal);
    $('#hl-bookmark-note-modal').on('click', function (e) {
        if (e.target === this) closeModal();
    });
}

// ====================================
// 형광펜 아이템 더보기 메뉴
// ====================================

export function showHighlightItemMoreMenu(e) {
    e.stopPropagation();

    const $existingMenu = $('#hl-item-more-menu');
    if ($existingMenu.length) {
        $existingMenu.remove();
        return;
    }
    closeAllMenus('#hl-item-more-menu');

    const $btn = $(e.currentTarget);
    const mesId = $btn.data('mesId');
    const hlId = $btn.data('hlId');
    const rect = $btn[0].getBoundingClientRect();

    // LLM 번역기 호환: 원문/번역문 수정 메뉴 항목 추가 여부
    const $hlItem = $btn.closest('.hl-highlight-item');
    const altField = $hlItem.data('altField');
    let translatorEditHtml = '';
    if (altField) {
        // 토글에 있는 텍스트 라벨 결정
        let editLabel = '원문/번역문 수정';
        const hlResult = findHighlightById(hlId);
        if (hlResult) {
            const hlData = hlResult.highlight;
            const pref = state.settings.translatorPanelDisplay || 'translated';
            if (hlData.sourceType === 'translated') {
                editLabel = (pref === 'original') ? '번역문 수정' : '원문 수정';
            } else if (hlData.sourceType === 'original') {
                editLabel = (pref === 'translated') ? '원문 수정' : '번역문 수정';
            }
        }
        translatorEditHtml = `
            <div class="hl-more-menu-divider"></div>
            <button class="hl-more-menu-item" data-action="edit-translator">
                <i class="fa-solid fa-language"></i>
                <span>${editLabel}</span>
            </button>
        `;
    }

    const menuHtml = `
        <div id="hl-item-more-menu" class="hl-more-menu ${getDarkModeClass()}" data-mes-id="${mesId}" data-hl-id="${hlId}">
            <button class="hl-more-menu-item" data-action="copy">
                <i class="fa-solid fa-copy"></i>
                <span>복사</span>
            </button>
            <button class="hl-more-menu-item" data-action="edit">
                <i class="fa-solid fa-pen"></i>
                <span>메모 수정</span>
            </button>${translatorEditHtml}
            <div class="hl-more-menu-divider"></div>
            <button class="hl-more-menu-item hl-menu-danger" data-action="delete">
                <i class="fa-solid fa-trash"></i>
                <span>삭제</span>
            </button>
        </div>
    `;

    $('body').append(menuHtml);

    const $newMenu = $('#hl-item-more-menu');

    // 메뉴 실제 크기 측정
    const menuRect = $newMenu[0].getBoundingClientRect();
    const menuWidth = menuRect.width;
    const menuHeight = menuRect.height;
    const margin = 8;

    // 기본 위치: 버튼 아래, 오른쪽 정렬
    let top = rect.bottom + 4;
    let left = rect.right - menuWidth;

    // 뷰포트 경계 클램핑
    if (left + menuWidth > window.innerWidth - margin) {
        left = window.innerWidth - menuWidth - margin;
    }
    if (left < margin) {
        left = margin;
    }
    if (top + menuHeight > window.innerHeight - margin) {
        top = rect.top - menuHeight - 4;
    }
    if (top < margin) {
        top = margin;
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
            case 'edit-translator':
                showTranslatorEditModal(menuHlId);
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

// ====================================
// 브레드크럼 더보기 메뉴
// ====================================

export function showBreadcrumbMoreMenu(e) {
    e.stopPropagation();

    const $existingMenu = $('#hl-breadcrumb-more-menu');
    if ($existingMenu.length) {
        $existingMenu.remove();
        return;
    }
    closeAllMenus('#hl-breadcrumb-more-menu');

    const $btn = $(e.currentTarget);
    const rect = $btn[0].getBoundingClientRect();

    // 정렬 옵션 결정 (state.currentView 기반)
    let sortItems = '';
    let deleteItem = '';
    const dirs = state.settings.sortOptions.directions || { characters: 'desc', chats: 'desc', highlights: 'desc' };
    const dirArrow = (type, value) => {
        if (state.settings.sortOptions[type] !== value) return '';
        return dirs[type] === 'asc'
            ? '<i class="fa-solid fa-arrow-up hl-menu-check"></i>'
            : '<i class="fa-solid fa-arrow-down hl-menu-check"></i>';
    };

    if (state.currentView === VIEW_LEVELS.HIGHLIGHT_LIST && state.selectedChat) {
        // 특정 채팅의 하이라이트 목록 뷰
        sortItems = `
            <button class="hl-more-menu-item" data-action="sort" data-sort-type="highlights" data-value="created">
                <i class="fa-solid fa-clock"></i>
                <span>최근 생성순</span>
                ${dirArrow('highlights', 'created')}
            </button>
            <button class="hl-more-menu-item" data-action="sort" data-sort-type="highlights" data-value="message">
                <i class="fa-solid fa-arrow-down-short-wide"></i>
                <span>채팅순</span>
                ${dirArrow('highlights', 'message')}
            </button>
        `;
        deleteItem = `
            <div class="hl-more-menu-divider"></div>
            <button class="hl-more-menu-item" data-action="select-delete">
                <i class="fa-solid fa-check-double"></i>
                <span>선택 삭제</span>
            </button>
            <button class="hl-more-menu-item hl-menu-danger" data-action="delete-chat">
                <i class="fa-solid fa-trash"></i>
                <span>모두 삭제</span>
            </button>
        `;
    } else if (state.currentView === VIEW_LEVELS.HIGHLIGHT_LIST && state.selectedCharacter && !state.selectedChat) {
        // 캐릭터 전체 형광펜 보기 뷰
        sortItems = `
            <button class="hl-more-menu-item" data-action="sort" data-sort-type="highlights" data-value="created">
                <i class="fa-solid fa-clock"></i>
                <span>최근 생성순</span>
                ${dirArrow('highlights', 'created')}
            </button>
            <button class="hl-more-menu-item" data-action="sort" data-sort-type="highlights" data-value="message">
                <i class="fa-solid fa-arrow-down-short-wide"></i>
                <span>채팅순</span>
                ${dirArrow('highlights', 'message')}
            </button>
        `;
        deleteItem = `
            <div class="hl-more-menu-divider"></div>
            <button class="hl-more-menu-item" data-action="select-delete">
                <i class="fa-solid fa-check-double"></i>
                <span>선택 삭제</span>
            </button>
            <button class="hl-more-menu-item hl-menu-danger" data-action="delete-character">
                <i class="fa-solid fa-trash"></i>
                <span>모두 삭제</span>
            </button>
        `;
    } else if (state.selectedCharacter) {
        // 채팅 목록 뷰
        sortItems = `
            <button class="hl-more-menu-item" data-action="sort" data-sort-type="chats" data-value="modified">
                <i class="fa-solid fa-clock"></i>
                <span>최근 수정순</span>
                ${dirArrow('chats', 'modified')}
            </button>
            <button class="hl-more-menu-item" data-action="sort" data-sort-type="chats" data-value="name">
                <i class="fa-solid fa-arrow-down-a-z"></i>
                <span>이름순</span>
                ${dirArrow('chats', 'name')}
            </button>
        `;
        deleteItem = `
            <div class="hl-more-menu-divider"></div>
            <button class="hl-more-menu-item" data-action="select-delete">
                <i class="fa-solid fa-check-double"></i>
                <span>선택 삭제</span>
            </button>
            <button class="hl-more-menu-item hl-menu-danger" data-action="delete-character">
                <i class="fa-solid fa-trash"></i>
                <span>모두 삭제</span>
            </button>
        `;
    } else {
        // 캐릭터 목록 (최상위)
        sortItems = `
            <button class="hl-more-menu-item" data-action="sort" data-sort-type="characters" data-value="modified">
                <i class="fa-solid fa-clock"></i>
                <span>최근 수정순</span>
                ${dirArrow('characters', 'modified')}
            </button>
            <button class="hl-more-menu-item" data-action="sort" data-sort-type="characters" data-value="name">
                <i class="fa-solid fa-arrow-down-a-z"></i>
                <span>이름순</span>
                ${dirArrow('characters', 'name')}
            </button>
        `;
    }

    const menuHtml = `
        <div id="hl-breadcrumb-more-menu" class="hl-more-menu ${getDarkModeClass()}">
            ${sortItems}
            ${deleteItem}
        </div>
    `;

    $('body').append(menuHtml);

    const $breadcrumbMenu = $('#hl-breadcrumb-more-menu');

    // 메뉴 실제 크기 측정
    const menuRect = $breadcrumbMenu[0].getBoundingClientRect();
    const menuWidth = menuRect.width;
    const menuHeight = menuRect.height;
    const margin = 8;

    // 기본 위치: 버튼 아래, 오른쪽 정렬
    let top = rect.bottom + 4;
    let left = rect.right - menuWidth;

    // 뷰포트 경계 클램핑
    if (left + menuWidth > window.innerWidth - margin) {
        left = window.innerWidth - menuWidth - margin;
    }
    if (left < margin) {
        left = margin;
    }
    if (top + menuHeight > window.innerHeight - margin) {
        top = rect.top - menuHeight - 4;
    }
    if (top < margin) {
        top = margin;
    }

    $breadcrumbMenu.css({
        position: 'fixed',
        top: top + 'px',
        left: left + 'px',
        zIndex: 100002
    });

    // 정렬 이벤트
    $('[data-action="sort"]').on('click', function () {
        const sortType = $(this).data('sortType');
        const value = $(this).data('value');
        if (!state.settings.sortOptions.directions) {
            state.settings.sortOptions.directions = { characters: 'desc', chats: 'desc', highlights: 'desc' };
        }
        if (state.settings.sortOptions[sortType] === value) {
            // 같은 옵션 재클릭 → 방향 토글
            state.settings.sortOptions.directions[sortType] =
                state.settings.sortOptions.directions[sortType] === 'desc' ? 'asc' : 'desc';
        } else {
            // 다른 옵션 선택 → 기본 방향 설정
            state.settings.sortOptions[sortType] = value;
            const defaultDir = (value === 'name' || value === 'message') ? 'asc' : 'desc';
            state.settings.sortOptions.directions[sortType] = defaultDir;
        }
        saveSettingsDebounced();
        $('#hl-breadcrumb-more-menu').remove();
        renderView();
    });

    // 삭제 이벤트
    $('[data-action="select-delete"]').on('click', function () {
        $('#hl-breadcrumb-more-menu').remove();
        enterSelectMode();
    });

    $('[data-action="delete-chat"]').on('click', function () {
        $('#hl-breadcrumb-more-menu').remove();
        deleteChatHighlights();
    });

    $('[data-action="delete-character"]').on('click', function () {
        $('#hl-breadcrumb-more-menu').remove();
        deleteCharacterHighlights();
    });

    // 외부 클릭 시 닫기
    setTimeout(() => {
        $(document).one('click', () => $('#hl-breadcrumb-more-menu').remove());
    }, 100);
}

// ====================================
// 헤더 더보기 메뉴
// ====================================

export function showHeaderMoreMenu(e) {
    e.stopPropagation();

    const $existingMenu = $('#hl-header-more-menu');
    if ($existingMenu.length) {
        $existingMenu.remove();
        return;
    }
    closeAllMenus('#hl-header-more-menu');

    const $btn = $(e.currentTarget);
    const rect = $btn[0].getBoundingClientRect();

    const darkModeIcon = state.settings.darkMode ? 'fa-sun' : 'fa-moon';
    const darkModeLabel = state.settings.darkMode ? '라이트모드' : '다크모드';
    const tabCountsIcon = state.settings.showTabCounts ? 'fa-toggle-on' : 'fa-toggle-off';

    const menuHtml = `
        <div id="hl-header-more-menu" class="hl-more-menu ${getDarkModeClass()}">
            <button class="hl-more-menu-item" data-action="toggle-dark">
                <i class="fa-solid ${darkModeIcon}"></i>
                <span>${darkModeLabel}</span>
            </button>
            <button class="hl-more-menu-item" data-action="toggle-tab-counts">
                <i class="fa-solid ${tabCountsIcon}"></i>
                <span>탭별 개수 표시</span>
            </button>
            <div class="hl-more-menu-divider"></div>
            <button class="hl-more-menu-item" data-action="export">
                <i class="fa-solid fa-download"></i>
                <span>백업</span>
            </button>
            <button class="hl-more-menu-item" data-action="import">
                <i class="fa-solid fa-upload"></i>
                <span>불러오기</span>
            </button>
            <div class="hl-more-menu-divider"></div>
            <button class="hl-more-menu-item" data-action="repair" style="color: #e65100;">
                <i class="fa-solid fa-wrench"></i>
                <span>데이터 복구</span>
            </button>
        </div>
    `;

    $('body').append(menuHtml);

    const $headerMenu = $('#hl-header-more-menu');

    // 메뉴 실제 크기 측정
    const menuRect = $headerMenu[0].getBoundingClientRect();
    const menuWidth = menuRect.width;
    const menuHeight = menuRect.height;
    const margin = 8;

    // 기본 위치: 버튼 아래, 오른쪽 정렬
    let top = rect.bottom + 4;
    let left = rect.right - menuWidth;

    // 뷰포트 경계 클램핑
    if (left + menuWidth > window.innerWidth - margin) {
        left = window.innerWidth - menuWidth - margin;
    }
    if (left < margin) {
        left = margin;
    }
    if (top + menuHeight > window.innerHeight - margin) {
        top = rect.top - menuHeight - 4;
    }
    if (top < margin) {
        top = margin;
    }

    $headerMenu.css({
        position: 'fixed',
        top: top + 'px',
        left: left + 'px',
        zIndex: 100002
    });

    // 이벤트 바인딩
    $headerMenu.find('[data-action="toggle-dark"]').on('click', function () {
        $('#hl-header-more-menu').remove();
        toggleDarkMode();
    });

    $headerMenu.find('[data-action="toggle-tab-counts"]').on('click', function () {
        state.settings.showTabCounts = !state.settings.showTabCounts;
        saveSettingsDebounced();
        updateTabCounts(getActiveTab());
        // 아이콘 토글 반영
        $(this).find('i').toggleClass('fa-toggle-on fa-toggle-off');
    });

    $headerMenu.find('[data-action="export"]').on('click', function () {
        $('#hl-header-more-menu').remove();
        _exportHighlights();
    });

    $headerMenu.find('[data-action="import"]').on('click', function () {
        $('#hl-header-more-menu').remove();
        $('#hl-import-file-input').click();
    });

    $headerMenu.find('[data-action="repair"]').on('click', function () {
        $('#hl-header-more-menu').remove();
        if (confirm('삭제된 캐릭터(잘못된 ID) 데이터를 복구하시겠습니까?\n\n이 작업은 주인 없는 형광펜 데이터를 찾아 올바른 캐릭터에게 병합합니다.')) {
            _repairOrphanedData();
        }
    });

    // 외부 클릭 시 닫기
    setTimeout(() => {
        $(document).one('click', () => $('#hl-header-more-menu').remove());
    }, 100);
}
