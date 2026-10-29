// One never-show matcher, used by the build (to screen everything downloaded) and by the page.
export function blockRegex(list) {
	const terms = list.split('\n').map((t) => t.trim().toLowerCase()).filter((t) => t && !t.startsWith('#'));
	const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+'));
	return esc.length ? new RegExp(`(?:^|[^\\p{L}])(?:${esc.join('|')})(?:s|es)?(?![\\p{L}])`, 'iu') : null;
}
