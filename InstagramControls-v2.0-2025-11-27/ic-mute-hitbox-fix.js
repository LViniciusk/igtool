/* Instagram mute hitbox compatibility fix for Controls for Instagram Videos.
 * Keeps Instagram's visible audio icon and forwards clicks from a small,
 * transparent hitbox when the video/overlays intercept the pointer.
 */
(() => {
    'use strict';

    const HITBOX_CLASS = 'ctrls4insta-audio-hitbox';
    const audioLabelPattern = /audio|mute|unmute|volume|sound|som|silenci|sonido|lautst|sonor|sonido/i;
    const hitboxes = new Map();

    function norm(value) {
        return (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function visibleVideoRect(video) {
        const r = video.getBoundingClientRect();
        return r.width >= 120 && r.height >= 120 &&
            r.right > 0 && r.left < window.innerWidth &&
            r.bottom > 0 && r.top < window.innerHeight ? r : null;
    }

    function findSpeaker(videoRect, icons) {
        let winner = null;
        let bestScore = -Infinity;

        for (const svg of icons) {
            const rect = svg.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10 ||
                rect.width > 65 || rect.height > 65) continue;

            if (rect.left < videoRect.left - 5 || rect.right > videoRect.right + 5 ||
                rect.top < videoRect.top - 5 || rect.bottom > videoRect.bottom + 5) continue;

            const iconLabel = [svg, svg.parentElement,
                svg.closest('button, [role="button"], [tabindex]')]
                .filter(Boolean)
                .map(el => norm([
                    el.getAttribute('aria-label'),
                    el.getAttribute('title'),
                    el.querySelector('title')?.textContent
                ].filter(Boolean).join(' '))).join(' ');
            const labelled = audioLabelPattern.test(iconLabel);

            // Fallback for unlabeled Instagram speaker icons: lower-right corner.
            const nearCorner = rect.right > videoRect.right - 85 &&
                rect.bottom > videoRect.bottom - 85;
            if (!labelled && !nearCorner) continue;

            const distance = Math.abs(videoRect.right - rect.right) +
                Math.abs(videoRect.bottom - rect.bottom);
            const score = (labelled ? 1000 : 0) - distance;
            if (score > bestScore) {
                winner = { source: svg, target: svg, rect };
                bestScore = score;
            }
        }
        // The Instagram speaker can also be a CSS-drawn icon with two pairs
        // of _acb* divs instead of an SVG. Mirror the entire decoration.
        for (const first of document.querySelectorAll('div._acb3')) {
            const group = first.parentElement;
            if (!group || group.closest('.ctrls4insta-audio-hitbox') ||
                !Array.from(group.children).some(child => child.matches('div._acb6'))) continue;

            const rect = group.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10 ||
                rect.width > 65 || rect.height > 65 ||
                rect.left < videoRect.left - 5 || rect.right > videoRect.right + 5 ||
                rect.top < videoRect.top - 5 || rect.bottom > videoRect.bottom + 5 ||
                rect.right < videoRect.right - 105 || rect.bottom < videoRect.bottom - 105) continue;

            const distance = Math.abs(videoRect.right - rect.right) +
                Math.abs(videoRect.bottom - rect.bottom);
            const score = 2000 - distance; // Prefer the real Instagram audio decoration.
            if (score > bestScore) {
                winner = {
                    source: group,
                    target: group.closest('button, [role="button"]') || group,
                    rect
                };
                bestScore = score;
            }
        }
        return winner;
    }

    function createHitbox() {
        const hitbox = document.createElement('span');
        hitbox.className = HITBOX_CLASS;
        hitbox.title = 'Ativar/desativar audio do Instagram';
        hitbox.style.cssText = [
            'position:fixed', 'display:none', 'box-sizing:border-box',
            'padding:0', 'margin:0', 'border:0', 'background:transparent',
            'pointer-events:auto!important', 'cursor:pointer',
            'z-index:2147483647!important'
        ].join(';');

        let target = null;
        hitbox.addEventListener('click', event => {
            event.stopPropagation();
            event.preventDefault();
            if (!target || !target.isConnected) return;
            // Dispatch on the actual SVG. The event bubbles to Instagram's
            // original React click handler even if its overlay ignores pointers.
            target.dispatchEvent(new MouseEvent('click', {
                bubbles: true, cancelable: true, composed: true,
                view: window
            }));
        });
        hitbox.setTarget = svg => { target = svg; };
        hitbox.style.display = 'flex';
        hitbox.style.alignItems = 'center';
        hitbox.style.justifyContent = 'center';
        // Mirror the complete Instagram decoration (including the _acb* divs),
        // rather than duplicating only its SVG. The clone is strictly visual.
        hitbox.renderClippedIcon = (source, rect) => {
            let clipped = false;
            for (let ancestor = source.parentElement; ancestor; ancestor = ancestor.parentElement) {
                const clip = ancestor.style?.getPropertyValue('clip-path') || '';
                const match = ancestor.style?.getPropertyPriority('clip-path') === 'important' &&
                    /^inset\(0px\s+0px\s+([\d.]+)px(?:\s+0px)?\)$/.exec(clip);
                if (match && rect.bottom > ancestor.getBoundingClientRect().bottom - Number(match[1])) {
                    clipped = true;
                    break;
                }
            }
            if (!clipped) {
                if (hitbox.firstChild) hitbox.replaceChildren();
                hitbox.style.background = 'transparent';
                hitbox.style.borderRadius = '0';
                hitbox._iconKey = '';
                return;
            }
            // When the source is clipped, its circular backdrop is clipped too.
            // In the modal the real Instagram button is still visible under the
            // transparent hitbox; in the feed we must paint that backdrop here.
            let button = source.closest('button, [role="button"]');
            let background = '';
            for (let node = button; node && node !== document.body; node = node.parentElement) {
                const box = node.getBoundingClientRect();
                if (box.width > 72 || box.height > 72) break;
                const color = getComputedStyle(node).backgroundColor;
                if (color && color !== 'transparent' &&
                    !/^rgba?\(0,\s*0,\s*0,\s*0(?:\.0+)?\)$/.test(color)) {
                    background = color;
                    break;
                }
            }
            hitbox.style.background = background || 'rgba(0, 0, 0, 0.65)';
            hitbox.style.borderRadius = '50%';
            const key = source.outerHTML + getComputedStyle(source).color;
            if (hitbox._iconKey === key) return;
            const copy = source.cloneNode(true);
            copy.classList.add('ctrls4insta-audio-mirror');
            copy.setAttribute('aria-hidden', 'true');
            // Exclude any injected hitboxes contained in the source subtree.
            copy.querySelectorAll('.ctrls4insta-audio-hitbox').forEach(el => el.remove());

            const originalNodes = [source, ...source.querySelectorAll('*')]
                .filter(el => !el.closest('.ctrls4insta-audio-hitbox'));
            const copiedNodes = [copy, ...copy.querySelectorAll('*')];
            const properties = [
                'display', 'box-sizing', 'position', 'top', 'left', 'right', 'bottom',
                'width', 'height', 'transform', 'opacity', 'visibility', 'overflow',
                'background', 'border', 'border-radius', 'box-shadow', 'color',
                'fill', 'stroke', 'stroke-width', 'filter', 'clip-path', 'animation',
                'margin', 'padding'
            ];
            originalNodes.forEach((node, index) => {
                const computed = getComputedStyle(node);
                const cloneStyle = copiedNodes[index].style;
                properties.forEach(prop => cloneStyle.setProperty(prop, computed.getPropertyValue(prop)));
                cloneStyle.pointerEvents = 'none';
            });
            copy.style.position = 'relative';
            copy.style.inset = 'auto';
            copy.style.margin = '0';
            copy.style.transform = 'none';
            copy.style.width = `${rect.width}px`;
            copy.style.height = `${rect.height}px`;
            copy.draggable = false;
            hitbox.replaceChildren(copy);
            hitbox._iconKey = key;
        };
        hitbox.draggable = false;
        hitbox.addEventListener('dragstart', event => event.preventDefault());
        document.body.appendChild(hitbox);
        return hitbox;
    }

    function sync() {
        if (!document.body) return;
        const videos = [...document.querySelectorAll('video')];
        const icons = [...document.querySelectorAll('svg')]
            .filter(svg => !svg.closest('.ctrls4insta-audio-hitbox'));
        const active = new Set();

        for (const video of videos) {
            const videoRect = visibleVideoRect(video);
            if (!videoRect) continue;
            const candidate = findSpeaker(videoRect, icons);
            if (!candidate) continue;
            active.add(video);
            let hitbox = hitboxes.get(video);
            if (!hitbox) {
                hitbox = createHitbox();
                hitboxes.set(video, hitbox);
            }

            // Only the speaker's immediate region intercepts input.
            const w = Math.max(30, Math.min(46, candidate.rect.width + 14));
            const h = Math.max(30, Math.min(46, candidate.rect.height + 14));
            hitbox.style.left = `${candidate.rect.left + (candidate.rect.width - w) / 2}px`;
            hitbox.style.top = `${candidate.rect.top + (candidate.rect.height - h) / 2}px`;
            hitbox.style.width = `${w}px`;
            hitbox.style.height = `${h}px`;
            hitbox.style.display = 'flex';
            hitbox.setTarget(candidate.target);
            hitbox.renderClippedIcon(candidate.source, candidate.rect);
        }

        for (const [video, hitbox] of hitboxes) {
            if (!active.has(video)) {
                hitbox.remove();
                hitboxes.delete(video);
            }
        }
    }

    // Instagram can reset media volume during a seek. Keep the last stable
    // user-selected volume, and ignore only transient volumechange events
    // from that seek (the main extension otherwise persists them as 100%).
    const seekVolume = new WeakMap();
    function volumeState(video) {
        let state = seekVolume.get(video);
        if (!state) {
            state = { preferred: video.volume, restoreUntil: 0, original: video.volume };
            seekVolume.set(video, state);
        }
        return state;
    }

    function restoreSeekVolume(video) {
        const state = volumeState(video);
        if (Date.now() > state.restoreUntil || !video.isConnected) return;
        if (Math.abs(video.volume - state.original) > 0.005) {
            video.volume = state.original;
        }
    }

    function beginSeek(video) {
        const state = volumeState(video);
        if (Date.now() > state.restoreUntil) {
            state.original = state.preferred;
        }
        state.restoreUntil = Date.now() + 1800;
        restoreSeekVolume(video);
    }

    function finishSeek(video) {
        const state = volumeState(video);
        state.restoreUntil = Math.max(state.restoreUntil, Date.now() + 1300);
        for (const delay of [0, 80, 250, 600, 1200]) {
            setTimeout(() => restoreSeekVolume(video), delay);
        }
    }

    document.addEventListener('seeking', event => {
        if (event.target instanceof HTMLVideoElement) beginSeek(event.target);
    }, true);
    document.addEventListener('seeked', event => {
        if (event.target instanceof HTMLVideoElement) finishSeek(event.target);
    }, true);
    document.addEventListener('volumechange', event => {
        const video = event.target;
        if (!(video instanceof HTMLVideoElement)) return;
        const state = volumeState(video);
        if (Date.now() <= state.restoreUntil) {
            if (Math.abs(video.volume - state.original) > 0.005) {
                // Stop the main player's debounced storage handler from turning
                // Instagram's transient volume reset into a saved preference.
                event.stopImmediatePropagation();
                restoreSeekVolume(video);
            }
        } else {
            state.preferred = video.volume;
        }
    }, true);

    // Do not place an HTML element over the native Chromium seek bar. It
    // steals :hover from the video and makes the native controls disappear.
    // Instead stop the containing Instagram link from starting HTML DnD.
    function preventSeekLinkDragging() {
        const originals = new Map();
        let seekVideo = null;
        let pointerTime = 0;

        function syncNativeControls() {
            const active = new Set();
            for (const video of document.querySelectorAll('video[controls]')) {
                if (!video.closest('article, [role="dialog"], [aria-modal="true"]')) continue;
                active.add(video);
                const link = video.closest('a[href]');
                if (link) active.add(link);
            }
            for (const element of active) {
                if (originals.has(element)) continue;
                originals.set(element, element.getAttribute('draggable'));
                element.setAttribute('draggable', 'false');
            }
            for (const [element, original] of originals) {
                if (active.has(element) && element.isConnected) continue;
                if (element.isConnected && element.getAttribute('draggable') === 'false') {
                    if (original === null) element.removeAttribute('draggable');
                    else element.setAttribute('draggable', original);
                }
                originals.delete(element);
            }
        }

        document.addEventListener('pointerdown', event => {
            seekVideo = null;
            if (event.button !== 0 || event.target.closest?.('.ctrls4insta-audio-hitbox')) return;
            for (const video of document.querySelectorAll('video[controls]')) {
                const rect = video.getBoundingClientRect();
                if (rect.width < 80 || rect.height < 80) continue;
                if (event.clientX >= rect.left && event.clientX <= rect.right &&
                    event.clientY >= Math.max(rect.top, rect.bottom - 64) &&
                    event.clientY <= rect.bottom) {
                    seekVideo = video;
                    pointerTime = Date.now();
                    break;
                }
            }
        }, true);
        document.addEventListener('dragstart', event => {
            if (!seekVideo || Date.now() - pointerTime > 5000) return;
            if (event.target === seekVideo || event.target?.contains?.(seekVideo) ||
                seekVideo.contains?.(event.target)) event.preventDefault();
        }, true);
        document.addEventListener('pointerup', () => { seekVideo = null; }, true);
        document.addEventListener('pointercancel', () => { seekVideo = null; }, true);
        syncNativeControls();
        return syncNativeControls;
    }

    // The extension already polls videos. This independent fix follows reels,
    // scrolling, and overlays without depending on their obfuscated class names.
    const start = () => {
        sync();
        const syncNativeControls = preventSeekLinkDragging();
        window.setInterval(() => {
            sync();
            syncNativeControls();
        }, 700);
        window.addEventListener('scroll', sync, { passive: true, capture: true });
        window.addEventListener('resize', sync, { passive: true });
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
