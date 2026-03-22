import { state } from './state.js';
import { chat } from '../../../../../script.js';
import { getRegexedString, regex_placement } from '../../../../../scripts/extensions/regex/engine.js';

export function batchUnwrapHighlights(selector) {
    const spans = document.querySelectorAll(selector || '.text-highlight');
    if (!spans.length) return;

    const affectedParents = new Set();
    for (const span of spans) {
        const parent = span.parentNode;
        if (!parent) continue;
        affectedParents.add(parent);
        while (span.firstChild) {
            parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
    }

    for (const parent of affectedParents) {
        parent.normalize();
    }
}

export function hexToRgba(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function deepMerge(target, source) {
    const result = { ...target };

    for (const key in source) {
        if (source.hasOwnProperty(key)) {
            if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
    }

    return result;
}

export function matchesSearch(text) {
    if (!state.searchQuery) return true;
    return text.toLowerCase().includes(state.searchQuery.toLowerCase());
}

export function highlightSearchMatch(text) {
    if (!state.searchQuery) return text;
    const escaped = state.searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="hl-search-match">$1</mark>');
}

export function stripAllFormatting(text, applyRegex = false) {
    if (!text) return '';

    if (applyRegex) {
        try {
            text = getRegexedString(text, regex_placement.AI_OUTPUT, { isMarkdown: false, isPrompt: false });
        } catch (e) {
            // regex 확장 비활성화 등 → 무시
        }
    }

    text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    text = text.replace(/```[\s\S]*?```/g, '');
    text = text.replace(/`[^`]+`/g, '');
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    text = text.replace(/<br\s*\/?>/gi, ' ');
    text = text.replace(/<\/?(?:p|div|li|tr|td|th|h[1-6]|blockquote|pre|hr|ul|ol|dl|dt|dd)(?:\s[^>]*)?\s*>/gi, ' ');
    text = text.replace(/<([a-zA-Z][a-zA-Z0-9_-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, '');
    text = text.replace(/<[a-zA-Z][a-zA-Z0-9_-]*(?:\s[^>]*)?\s*\/>/g, '');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/\[\/?[A-Z][A-Z0-9_]*\]/g, '');
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
    text = text.replace(/_{1,3}([^_]+)_{1,3}/g, '$1');
    text = text.replace(/~~([^~]+)~~/g, '$1');
    text = text.replace(/^#{1,6}\s+/gm, '');
    text = text.replace(/^>+\s?/gm, '');
    text = text.replace(/^[-*_]{3,}$/gm, '');
    text = text.replace(/^[\s]*[-*+]\s+/gm, '');
    text = text.replace(/^[\s]*\d+\.\s+/gm, '');
    text = text.replace(/\s+/g, ' ').trim();
    return text;
}

export function getMessagePreview(mesId, maxLen = 80) {
    const message = chat[mesId];
    if (!message) return '';

    if (state.settings.translatorCompat && state.settings.translatorPanelDisplay === 'translated') {
        const $mes = $(`.mes[mesid="${mesId}"]`);
        const $translated = $mes.find('.custom-translated_text');
        if ($translated.length) {
            const translatedText = stripAllFormatting($translated.text() || '', true);
            if (translatedText) {
                return translatedText.length > maxLen ? translatedText.substring(0, maxLen) + '...' : translatedText;
            }
        }
    }

    const text = stripAllFormatting(message.mes || '', true);
    return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}

export function cleanStoredPreview(preview, maxLen = 80) {
    const text = stripAllFormatting(preview);
    return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}
