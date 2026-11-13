// The settings window: in the middle of the screen, the page live behind
// it. Built once from the model; `refresh` sets every control from the
// settings and shows what the open book has (a book of pictures has no
// type, margins or frame).

import { palettes, toneNames, faces, papers, paperNames, ranges, lineHeight, isNight, tone } from './model.js';
import { t, languages } from './i18n.js';

/// A tone's name as a key: «Light» the tone is not «Light» the mode.
const toneKey = (index) => (toneNames[index] === 'Light' ? 'Light tone' : toneNames[index]);

const element = (tag, attributes = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('data-') || key.startsWith('aria-') || key === 'role' || key === 'for') node.setAttribute(key, value);
        else node[key] = value;
    }
    node.append(...children.filter(Boolean));
    return node;
};

/// A choice by words: the platform's segmented control.
const segmented = (setting, options) => element('div', { class: 'segmented', role: 'radiogroup', 'data-setting': setting },
    ...options.map(([value, label]) => element('button', { type: 'button', role: 'radio', 'data-value': value, text: t(label) })));

const slider = (setting, range, label) => element('div', { class: 'slider' },
    element('input', { type: 'range', min: range.min, max: range.max, step: range.step, 'data-slider': setting, 'aria-label': t(label) }),
    element('output', { 'data-output': setting }));

/// The text frames as small pages: a sheet, three lines of text, the rule.
const frames = [
    ['none', 'No frame', '', 'two'],
    ['shadow', 'Shadow between columns', '<rect x="15" y="3" width="6" height="38" fill="url(#gutterShade)" stroke="none"/>', 'two'],
    ['lines', 'Line between columns', '<path d="M18 6v32"/>', 'two'],
    ['single', 'Rule', '<rect x="4.5" y="4.5" width="27" height="35" rx="0.5"/>'],
    ['double', 'Double rule', '<rect x="3.5" y="3.5" width="29" height="37"/><rect x="6" y="6" width="24" height="32"/>'],
    ['notched', 'Ticket', '<path d="M8 4.5h20a3.5 3.5 0 0 0 3.5 3.5v28a3.5 3.5 0 0 0-3.5 3.5H8A3.5 3.5 0 0 0 4.5 36V8A3.5 3.5 0 0 0 8 4.5z"/>'],
    ['vintage', 'Vintage', '<rect x="3.5" y="3.5" width="29" height="37"/><rect x="6" y="6" width="24" height="32"/><circle cx="6" cy="6" r="1.6"/><circle cx="30" cy="6" r="1.6"/><circle cx="6" cy="38" r="1.6"/><circle cx="30" cy="38" r="1.6"/>'],
];
/// One column of text inside the rule, or two with the gutter between.
const frameTile = (drawing, kind) => `<svg viewBox="0 0 36 44">${kind === 'two'
    ? '<defs><linearGradient id="gutterShade"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset="0.5" stop-color="currentColor" stop-opacity="0.35"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><g class="lines"><path d="M6 12h9M6 17h9M6 22h9M6 27h9M6 32h6M21 12h9M21 17h9M21 22h9M21 27h9M21 32h6"/></g>'
    : '<g class="lines"><path d="M10 14h16M10 19h16M10 24h16M10 29h10"/></g>'}<g class="rule">${drawing}</g></svg>`;

const row = (label, control, attributes = {}) => element('div', Object.assign({ class: 'row' }, attributes), element('span', { class: 'name', text: t(label) }), control);

/// Under the settings of the other light: why the page does not change,
/// and the key that shows them.
const elsewhere = (words, light) => element('p', { class: 'elsewhere' },
    element('span', { text: t(words) }), ' ',
    element('button', { type: 'button', class: 'link', 'data-show': light, text: t('Turn on') }));

export function settingsPanel(dialog, { settings, onChange, onReset, onLanguage, context }) {
  function build() {
    const heading = element('header', {},
        element('h2', { text: t('Reading settings') }),
        element('button', { type: 'button', class: 'icon', id: 'panelClose', 'aria-label': t('Close'), innerHTML: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' }));

    const colour = element('section', {},
        element('h3', { text: t('Colour') }),
        row('Light', segmented('light', [['auto', 'Auto'], ['day', 'Day'], ['night', 'Night']])),
        row('Palette', element('div', { class: 'swatches', id: 'palettes' })),
        element('div', { class: 'when', 'data-when': 'day' },
            row('Day', element('div', { class: 'slider tone' }, element('input', { type: 'range', min: 0, max: 6, step: 1, 'data-slider': 'dayTone', 'aria-label': t('Day tone') }), element('output', { 'data-output': 'dayTone' }))),
            elsewhere('Applies in day mode.', 'day')),
        element('div', { class: 'when', 'data-when': 'night' },
            row('Night', element('div', { class: 'slider tone' }, element('input', { type: 'range', min: 0, max: 6, step: 1, 'data-slider': 'nightTone', 'aria-label': t('Night tone') }), element('output', { 'data-output': 'nightTone' }))),
            row('Text at night', slider('nightText', ranges.nightText, 'Text brightness at night'), { 'data-text': '' }),
            row('Pages at night', slider('nightPages', ranges.nightPages, 'Page brightness at night'), { 'data-pictures': '' }),
            elsewhere('Applies in night mode.', 'night')),
        row('Pages', element('label', { class: 'switch' },
            element('input', { type: 'checkbox', id: 'transparentPages', role: 'switch' }),
            element('span', { text: t('Transparent page background') })), { 'data-pictures': '' }));

    const text = element('section', { 'data-text': '' },
        element('h3', { text: t('Text') }),
        element('div', { class: 'faces', role: 'radiogroup', 'data-setting': 'face' }, ...Object.entries(faces).map(([id, face]) =>
            element('button', { type: 'button', role: 'radio', 'data-value': id },
                element('span', { class: 'sample', text: 'Aa', style: `font-family: ${face.stack}` }),
                element('span', { text: t(face.name) })))),
        row('Size', slider('size', ranges.size, 'Font size')),
        row('Line spacing', slider('leading', ranges.leading, 'Line spacing')),
        row('Alignment', segmented('align', [['justify', 'Justified'], ['left', 'Ragged']])));

    const layout = element('section', {},
        element('h3', { text: t('Layout') }),
        row('Reading', segmented('layout', [['scroll', 'Scroll'], ['pages', 'Pages']])),
        row('Columns', segmented('columns', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]), { 'data-turning': '' }),
        row('Page turn', segmented('turn', [['on', 'Slide'], ['off', 'At once']]), { 'data-turning': '' }),
        row('Direction', element('div', { class: 'segmented', role: 'radiogroup', 'data-setting': 'direction' },
            element('button', { type: 'button', role: 'radio', 'data-value': 'ltr', text: `${t('Left to right')} →` }),
            element('button', { type: 'button', role: 'radio', 'data-value': 'rtl', text: `← ${t('Right to left')}` }))));

    const sheet = element('section', {},
        element('h3', { text: t('Page') }),
        row('Paper', element('div', { class: 'papers' }, ...papers.map((paper) => element('button', {
            type: 'button', class: 'paper', 'data-paper': paper, title: t(paperNames[paper]), 'aria-label': t(paperNames[paper]),
        }, element('span', { text: paper === 'none' ? 'Aa' : '' }))))),
        row('Grain', slider('paperStrength', ranges.paperStrength, 'Paper grain'), { 'data-grain': '' }),
        row('Frame', element('div', { class: 'frames', role: 'radiogroup', 'data-setting': 'frame' }, ...frames.map(([id, name, drawing, kind]) =>
            element('button', { type: 'button', role: 'radio', 'data-value': id, title: t(name), 'aria-label': t(name), innerHTML: frameTile(drawing, kind) }))), { 'data-text': '' }),
        row('Margins', slider('margins', ranges.margins, 'Margins'), { 'data-text': '' }));

    const footer = element('footer', {},
        element('button', { type: 'button', class: 'quiet', id: 'panelReset', text: t('Reset to defaults') }),
        element('label', { class: 'language' }, element('span', { text: t('Language') }),
            element('select', { id: 'language' },
                element('option', { value: 'auto', text: t('As the browser') }),
                ...Object.entries(languages).map(([code, name]) => element('option', { value: code, text: name })))));

    dialog.replaceChildren(heading, element('div', { class: 'columns' }, element('div', {}, colour, sheet), element('div', {}, text, layout)), footer);

    // The paper tiles wear their grain.
    for (const tile of dialog.querySelectorAll('.paper')) {
        if (tile.dataset.paper !== 'none') tile.style.backgroundImage = `url("engine/paper/${tile.dataset.paper}.png")`;
    }
    dialog.setAttribute('aria-label', t('Reading settings'));
    refresh();
  }

    const formats = {
        size: (v) => `${v}`,
        leading: () => lineHeight(settings).toFixed(2),
        margins: (v) => `${v}%`,
        nightText: (v) => `${v}%`,
        nightPages: (v) => `${v}%`,
        paperStrength: (v) => `${v}%`,
        dayTone: (v) => t(toneKey(v)),
        nightTone: (v) => t(toneKey(v)),
    };

    dialog.addEventListener('input', (event) => {
        const input = event.target;
        if (input.dataset.slider) {
            settings[input.dataset.slider] = Number(input.value);
            onChange(input.dataset.slider);
        } else if (input.id === 'language') {
            settings.language = input.value;
            onLanguage();
        } else if (input.id === 'transparentPages') {
            settings.transparentPages = input.checked;
            onChange('transparentPages');
        }
    });
    dialog.addEventListener('click', (event) => {
        const key = event.target.closest('button');
        if (!key) return;
        if (key.id === 'panelClose') return dialog.close();
        if (key.id === 'panelReset') return onReset();
        if (key.dataset.paper) { settings.paper = key.dataset.paper; return onChange('paper'); }
        if (key.dataset.palette) { settings.palette = key.dataset.palette; return onChange('palette'); }
        if (key.dataset.show) return show(key.dataset.show);
        const group = key.closest('[data-setting]');
        if (group && key.dataset.value !== undefined) onChange(group.dataset.setting, key.dataset.value);
    });
    // «Turn on» under the other light's settings switches the light; the
    // one under these takes the reader back to the light they had (Auto,
    // say) when that gives the look asked for.
    let returnTo = null;
    function show(light) {
        const back = returnTo !== null && (isNight({ light: returnTo }) ? 'night' : 'day') === light ? returnTo : null;
        returnTo = back === null ? settings.light : null;
        onChange('light', back ?? light);
        dialog.querySelector(`[data-when="${light}"] input`)?.focus();
    }

    // A click on the backdrop closes.
    dialog.addEventListener('pointerdown', (event) => {
        if (event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
        if (outside) dialog.close();
    });

    function refresh() {
        const { pictures, shown } = context();
        for (const group of dialog.querySelectorAll('[data-setting]')) {
            for (const key of group.querySelectorAll('[data-value]')) {
                const chosen = shown[group.dataset.setting] === key.dataset.value;
                key.classList.toggle('chosen', chosen);
                key.setAttribute('aria-checked', String(chosen));
            }
        }
        for (const input of dialog.querySelectorAll('[data-slider]')) {
            const name = input.dataset.slider;
            input.value = settings[name];
            const share = (settings[name] - input.min) / (input.max - input.min);
            input.style.setProperty('--fill', `${(share * 100).toFixed(1)}%`);
            dialog.querySelector(`[data-output="${name}"]`).textContent = formats[name](settings[name]);
        }
        dialog.querySelector('#transparentPages').checked = settings.transparentPages;
        dialog.querySelector('#language').value = settings.language || 'auto';
        for (const tile of dialog.querySelectorAll('.paper')) tile.classList.toggle('chosen', tile.dataset.paper === settings.paper);

        // The palettes as the page each gives at this light; the tone
        // sliders' tracks as the palette's seven pages.
        const index = tone(settings);
        dialog.querySelector('#palettes').replaceChildren(...Object.entries(palettes).map(([id, palette]) =>
            element('button', { type: 'button', class: settings.palette === id ? 'swatch chosen' : 'swatch', 'data-palette': id, title: t(palette.name), 'aria-label': t(palette.name), text: 'Aa', style: `background: ${palette.bg[index]}; color: ${palette.text[index]}` })));
        const palette = palettes[settings.palette];
        const stops = palette.bg.map((bg, i) => `${bg} ${(i / 7 * 100).toFixed(2)}% ${((i + 1) / 7 * 100).toFixed(2)}%`).join(', ');
        for (const input of dialog.querySelectorAll('.tone input')) input.style.setProperty('--track', `linear-gradient(to right, ${stops})`);
        // The other light's settings, muted, with a word on why.
        const now = isNight(settings) ? 'night' : 'day';
        for (const block of dialog.querySelectorAll('[data-when]')) {
            const away = block.dataset.when !== now;
            block.classList.toggle('away', away);
            block.querySelector('.elsewhere').hidden = !away;
        }

        for (const node of dialog.querySelectorAll('[data-text]')) node.hidden = pictures;
        for (const node of dialog.querySelectorAll('[data-pictures]')) node.hidden = !pictures;
        for (const node of dialog.querySelectorAll('[data-turning]')) node.hidden = shown.layout === 'scroll';
        dialog.querySelector('[data-grain]').hidden = settings.paper === 'none';
        for (const key of dialog.querySelectorAll('[data-setting="columns"] button')) key.hidden = pictures && +key.dataset.value > 2;
        dialog.querySelector('[data-setting="layout"] [data-value="scroll"]').textContent = t(pictures ? 'Strip' : 'Scroll');
    }

    build();
    return { refresh, build };
}
