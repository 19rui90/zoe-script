// ==UserScript==
// @name         ZOE - ManagerZone Assistant
// @namespace    https://www.managerzone.com/
// @version      1.5.0
// @description  Extrai automáticamente dados dos jogos realizados (funciona em qualquer página do MZ)
// @author       ruisimoes
// @match        https://www.managerzone.com/*
// @match        https://www.terabox.com/*
// @match        https://1024terabox.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=managerzone.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// ==/UserScript==

(function () {
    'use strict';

    const TEAM_ID = '1146058';
    let OUR_TEAM_NAME = '';

    const TERABOX_CONFIG_KEY = 'zoe_terabox_config';
    const TERABOX_LAST_BACKUP_KEY = 'zoe_last_backup_terabox';
    const TERABOX_FOLDER = '/ZOE - Backups (script)';
    const TERABOX_APP_ID = '250528';
    const TERABOX_BASE = 'https://www.terabox.com';

    function isOnTerabox() {
        return location.hostname === 'www.terabox.com' || location.hostname === '1024terabox.com';
    }

    function isOnManagerZone() {
        return location.hostname === 'www.managerzone.com';
    }

    function captureTeraboxCookies() {
        const cookies = document.cookie;
        const result = {};
        cookies.split(';').forEach(c => {
            const [key, ...val] = c.trim().split('=');
            if (key && val.length) result[key.trim()] = val.join('=').trim();
        });
        return result;
    }

    function extractTeraboxTokensFromHTML(html) {
        const tokens = {};
        const jtMatch = html.match(/fn\(\x22([^\x29]+)\x22\)/);
        if (jtMatch && jtMatch[1]) tokens.jsToken = jtMatch[1];
        const btMatch = html.match(/"bdstoken"\s*:\s*"([^"]+)"/);
        if (btMatch && btMatch[1]) tokens.bdstoken = btMatch[1];
        return tokens;
    }

    function saveTeraboxConfig(config) {
        GM_setValue(TERABOX_CONFIG_KEY, JSON.stringify(config));
    }

    function getTeraboxConfig() {
        try { return JSON.parse(GM_getValue(TERABOX_CONFIG_KEY, 'null')); } catch(e) { return null; }
    }

    function captureAllTeraboxData() {
        const cookies = captureTeraboxCookies();
        const existing = getTeraboxConfig() || {};
        const config = Object.assign({}, existing);
        if (cookies.ndus) config.ndus = cookies.ndus;
        if (cookies.csrfToken) config.csrfToken = cookies.csrfToken;
        if (cookies.browserid) config.browserid = cookies.browserid;
        if (cookies.ndut_fmt) config.ndut_fmt = cookies.ndut_fmt;
        saveTeraboxConfig(config);
        console.log('ZOE TB: cookies capturados do TeraBox:', Object.keys(cookies).join(', '));
        try {
            const html = document.documentElement.innerHTML;
            const tokens = extractTeraboxTokensFromHTML(html);
            if (tokens.jsToken || tokens.bdstoken) {
                const cfg = getTeraboxConfig() || {};
                if (tokens.jsToken) cfg.jsToken = tokens.jsToken;
                if (tokens.bdstoken) cfg.bdstoken = tokens.bdstoken;
                saveTeraboxConfig(cfg);
                console.log('ZOE TB: tokens capturados da página:', Object.keys(tokens).join(', '));
            }
        } catch(e) { console.warn('ZOE TB: erro ao extrair tokens da página:', e.message); }
        return config;
    }

    if (isOnTerabox()) {
        console.log('ZOE: detetado TeraBox, a capturar cookies...');
        const config = captureAllTeraboxData();
        if (config.ndus) {
            const banner = document.createElement('div');
            banner.style.cssText = 'position:fixed;top:10px;right:10px;background:#1a1a2e;color:#4caf50;border:1px solid #4caf50;border-radius:8px;padding:12px 16px;z-index:999999;font-family:Arial,sans-serif;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,0.5)';
            banner.innerHTML = '<strong>ZOE:</strong> Cookies do TeraBox capturados com sucesso! Podes fechar esta página.';
            document.body.appendChild(banner);
            setTimeout(() => banner.remove(), 5000);
        }
        return;
    }

    if (!isOnManagerZone()) return;

    function detectOurTeamName() {
        const fn = document.querySelector(`a[href*="tid=${TEAM_ID}"] .full-name`);
        if (fn) OUR_TEAM_NAME = fn.textContent.trim();
        if (!OUR_TEAM_NAME) {
            const link = document.querySelector(`a[href*="tid=${TEAM_ID}"]`);
            if (link) {
                const t = link.textContent.trim();
                if (!/^\d+\s*-\s*\d+$/.test(t)) OUR_TEAM_NAME = t;
            }
        }
        if (OUR_TEAM_NAME) console.log('ZOE: equipa detetada:', OUR_TEAM_NAME);
    }

    const CONFIG = {
        fetchIntervalMs: 30 * 60 * 1000,
    };

    // --- Pure regex extraction from raw HTML (no DOM used) ---

    function extractAllFromRaw(html) {
        if (!html) return [];
        const matches = [];
        let currentDate = '';

        let pos = 0;
        while (pos < html.length) {
            const dateStart = html.indexOf('<dd class="group"', pos);
            const oddRe = html.slice(pos).match(/<dd class="odd(?:"| )/);
            const evenRe = html.slice(pos).match(/<dd class="even(?:"| )/);
            const matchStartOdd = oddRe ? pos + oddRe.index : -1;
            const matchStartEven = evenRe ? pos + evenRe.index : -1;

            let candidates = [];
            if (dateStart !== -1) candidates.push({ type: 'date', pos: dateStart });
            if (matchStartOdd !== -1) candidates.push({ type: 'match', pos: matchStartOdd });
            if (matchStartEven !== -1) candidates.push({ type: 'match', pos: matchStartEven });

            if (candidates.length === 0) break;

            candidates.sort((a, b) => a.pos - b.pos);
            const next = candidates[0];

            if (next.type === 'date') {
                const tagEnd = html.indexOf('>', next.pos);
                const closeTag = html.indexOf('</dd>', tagEnd);
                if (closeTag === -1) { pos = next.pos + 1; continue; }
                const dateText = html.substring(tagEnd + 1, closeTag).trim();
                const d = dateText.match(/(\d{2}-\d{2}-\d{4})/);
                if (d) currentDate = d[1];
                pos = closeTag + 5;
            } else {
                const tagEnd = html.indexOf('>', next.pos);
                let depth = 1;
                let scan = tagEnd + 1;

                while (scan < html.length && depth > 0) {
                    const nextOpen = html.indexOf('<dd', scan);
                    const nextClose = html.indexOf('</dd>', scan);

                    if (nextClose === -1) break;
                    if (nextOpen !== -1 && nextOpen < nextClose) {
                        const after = html.charAt(nextOpen + 3);
                        if (after === ' ' || after === '>' || after === '\n' || after === '\t') {
                            depth++;
                        }
                        scan = nextOpen + 3;
                    } else {
                        depth--;
                        scan = nextClose + 5;
                    }
                }

                const outerClose = html.indexOf('</dd>', scan - 5);
                const blockEnd = (outerClose !== -1 && outerClose < scan) ? outerClose : scan - 5;
                const block = html.substring(tagEnd + 1, blockEnd);

                if (outerClose !== -1 && outerClose < scan) {
                    pos = outerClose + 5;
                } else {
                    pos = scan;
                }

                const matchData = parseMatchBlock(block, currentDate);
                if (matchData) {
                    matches.push(matchData);
                }
            }
        }

        return matches;
    }

    function parseMatchBlock(block, currentDate) {
        if (!/<dd[^>]*class="[^"]*match-time[^"]*"/.test(block)) return null;

        const timeM = block.match(/<dd[^>]*class="[^"]*match-time[^"]*">(\d{2}:\d{2})/);
        const time = timeM ? timeM[1] : '';

        const typeM = block.match(/match-reference-text-wrapper[^>]*>\s*<span>([^<]*)<\/span>/);
        const matchType = typeM ? typeM[1].trim() : '';

        const wrapperM = block.match(/match-reference-text-wrapper[^>]*>([\s\S]*?)<\/dd>/);
        let competition = '';
        if (wrapperM) {
            const inner = wrapperM[1];
            const linkM = inner.match(/<a[^>]*>([^<]*)<\/a>/);
            if (linkM) {
                competition = linkM[1].trim();
            } else {
                const afterSpan = inner.replace(/<span[^>]*>([^<]*)<\/span>/, '').trim();
                competition = afterSpan.replace(/^vs\s*/, '').trim();
            }
        }

        const homeNameM = block.match(/home-team-column[^>]*>[\s\S]*?<span class="full-name">([^<]*)<\/span>/);
        const homeName = homeNameM ? homeNameM[1].trim() : '';

        const homeEloM = block.match(/home-team-column[\s\S]*?<br>\s*(\d+)/);
        const homeElo = homeEloM ? homeEloM[1] : '';

        const awayNameM = block.match(/away-team-column[^>]*>[\s\S]*?<span class="full-name">([^<]*)<\/span>/);
        const awayName = awayNameM ? awayNameM[1].trim() : '';

        const awayEloM = block.match(/away-team-column[\s\S]*?<br>\s*(\d+)/);
        const awayElo = awayEloM ? awayEloM[1] : '';

        let isHome = false, isAway = false;
        if (OUR_TEAM_NAME) {
            isHome = homeName === OUR_TEAM_NAME;
            isAway = !isHome && awayName === OUR_TEAM_NAME;
        }
        if (!isHome && !isAway && OUR_TEAM_NAME) {
            if (homeName.indexOf(OUR_TEAM_NAME) !== -1) isHome = true;
            if (awayName.indexOf(OUR_TEAM_NAME) !== -1) isAway = true;
        }
        if (!isHome && !isAway) {
            const ourTidHref = `tid=${TEAM_ID}`;
            const homePart = block.indexOf('home-team-column');
            const awayPart = block.indexOf('away-team-column');
            const tidPos = block.indexOf(ourTidHref);
            if (tidPos > -1 && homePart > -1 && awayPart > -1) {
                const distToHome = Math.abs(tidPos - homePart);
                const distToAway = Math.abs(tidPos - awayPart);
                if (distToHome < distToAway) isHome = true;
                else isAway = true;
            }
        }

        let homeScore = '', awayScore = '', scoreText = '';
        const scoreM = block.match(/<a[^>]*class="[^"]*score-shown[^"]*"[^>]*>\s*(\d+)\s*-\s*(\d+)\s*<\/a>/);
        if (scoreM) {
            homeScore = scoreM[1];
            awayScore = scoreM[2];
            scoreText = homeScore + ' - ' + awayScore;
        }
        if (!scoreText) {
            const hiddenM = block.match(/<a[^>]*class="[^"]*score-hidden[^"]*"[^>]*>([^<]*)<\/a>/);
            if (hiddenM && hiddenM[1].trim() !== 'vs') {
                const s = hiddenM[1].trim();
                const p = s.split('-').map(x => x.trim());
                if (p.length === 2 && /^\d+$/.test(p[0]) && /^\d+$/.test(p[1])) {
                    homeScore = p[0];
                    awayScore = p[1];
                    scoreText = s;
                }
            }
        }
        if (!scoreText) {
            const fallbackM = block.match(/(\d+)\s*-\s*(\d+)/);
            if (fallbackM) {
                homeScore = fallbackM[1];
                awayScore = fallbackM[2];
                scoreText = fallbackM[0].trim();
            }
        }

        const ourScore = isHome ? homeScore : (isAway ? awayScore : '');
        const theirScore = isHome ? awayScore : (isAway ? homeScore : '');

        let matchId = '';
        const midM = block.match(/mid=(\d+)/);
        if (midM) matchId = midM[1];

        const tacticM = block.match(/<a[^>]*class="[^"]*gradientSunriseIcon[^"]*"[^>]*>([^<]*)<\/a>/);
        const tactic = tacticM ? tacticM[1].trim() : '';

        return {
            date: currentDate,
            time,
            season: getSeason(currentDate),
            type: matchType,
            competition,
            category: detectCategory(matchType, competition, tactic),
            homeElo,
            homeTeam: homeName,
            awayTeam: awayName,
            awayElo,
            homeScore,
            awayScore,
            ourScore,
            theirScore,
            matchId,
            tactic,
            isHome,
            isAway,
            result: !scoreText ? 'pending' : homeScore === awayScore ? 'draw' : parseInt(ourScore) > parseInt(theirScore) ? 'win' : 'loss'
        };
    }

    // --- AJAX fetch ---

    function fetchMatchListHTML() {
        return new Promise((resolve) => {
            const $ = unsafeWindow.jQuery;
            if (!$) {
                console.warn('ZOE: jQuery não encontrado na página');
                resolve(null);
                return;
            }
            const form = document.getElementById('matchListForm');
            let postData;
            if (form) {
                postData = $(form).serialize().replace(/limit=[^&]*/, 'limit=max').replace(/hidescore=[^&]*/, 'hidescore=false');
                postData = postData.replace(/tid1=[^&]*/, 'tid1=' + TEAM_ID);
                if (postData.indexOf('tid1=') === -1) postData += '&tid1=' + TEAM_ID;
                if (postData.indexOf('selectType=') === -1) postData += '&selectType=all';
            } else {
                postData = 'limit=max&selectType=all&tid1=' + TEAM_ID + '&hidescore=false';
            }
            console.log('ZOE: POST data:', postData);
            $.ajax({
                url: '/ajax.php?p=matches&sub=list&sport=soccer',
                method: 'POST',
                data: postData,
                success: function (html) {
                    const rawLen = typeof html === 'string' ? html.length : JSON.stringify(html).length;
                    console.log('ZOE: AJAX response size:', rawLen, 'bytes, type:', typeof html);
                    resolve(html);
                },
                error: function (jqXHR) {
                    console.error('ZOE: erro jQuery AJAX:', jqXHR.status, jqXHR.statusText);
                    resolve(null);
                },
            });
        });
    }

    async function fetchAndParseMatches() {
        try {
            const text = await fetchMatchListHTML();
            if (!text) {
                console.warn('ZOE: resposta vazia');
                return null;
            }
            let rawHtml = text;
            if (text.trim().startsWith('{')) {
                try {
                    const json = JSON.parse(text);
                    if (json.list && typeof json.list === 'string' && json.list.length > 0) {
                        rawHtml = json.list;
                    } else if (json.filter_form && typeof json.filter_form === 'string') {
                        rawHtml = json.filter_form;
                    }
                } catch (e) {
                    console.warn('ZOE: erro a fazer parse JSON', e);
                }
            }
            const totalBlocks = (rawHtml.match(/<dd class="(odd|even)(?:"| )/g) || []).length;
            const matches = extractAllFromRaw(rawHtml);
            if (totalBlocks !== matches.length) {
                console.warn(`ZOE: contagem de jogos — ${totalBlocks} blocos no HTML, ${matches.length} extraídos`);
            }
            if (matches.length > 0) {
                const m = matches[0];
                console.log('ZOE: primeiro jogo:', m.homeTeam, m.homeScore + '-' + m.awayScore, m.awayTeam, '| isHome:', m.isHome, 'isAway:', m.isAway);
            }
            return matches;
        } catch (e) {
            console.warn('ZOE: erro ao buscar jogos', e);
            return null;
        }
    }

    let showRecentResults = false;
    let editMode = false;

    function isLast24h(m) {
        if (!m.date || !m.time) return false;
        const parts = m.date.split('-');
        if (parts.length !== 3) return false;
        const tp = (m.time || '0:0').split(':').map(Number);
        const matchDate = new Date(+parts[2], +parts[1] - 1, +parts[0], tp[0] || 0, tp[1] || 0);
        return (Date.now() - matchDate.getTime()) <= 24 * 60 * 60 * 1000;
    }

    function getVisibleMatches(all) {
        return showRecentResults ? all : all.filter(m => !isLast24h(m));
    }

    // --- Storage ---

    function loadMatches() {
        return JSON.parse(GM_getValue('zoe_matches', '[]'));
    }

    function hasMatchesWithoutElo() {
        const all = loadMatches();
        return all.some(m => m.result !== 'pending' && (!m.homeElo || !m.awayElo));
    }

    function hasMatchesWithoutValues() {
        const all = loadMatches();
        return all.some(m => m.result !== 'pending' && m.matchId && (!m.homeValue || !m.awayValue));
    }

    function updateEloBtnVisibility() {
        const eloBtn = document.getElementById('zoe-elo-btn');
        if (!eloBtn) return;
        eloBtn.style.display = hasMatchesWithoutElo() ? '' : 'none';
    }

    function updateValueBtnVisibility() {
        const valueBtn = document.getElementById('zoe-value-btn');
        if (!valueBtn) return;
        valueBtn.style.display = hasMatchesWithoutValues() ? '' : 'none';
    }

    function saveMatches(matches) {
        const existing = loadMatches();
        const seen = new Set(existing.map(m => m.matchId));
        let newCount = 0;
        for (const m of matches) {
            if (m.result === 'pending') continue;
            if (!seen.has(m.matchId) && m.matchId) {
                existing.push(m);
                seen.add(m.matchId);
                newCount++;
            }
        }
        if (newCount > 0) {
            GM_setValue('zoe_matches', JSON.stringify(sortMatchesByDate(existing)));
        }
        return { all: existing, new: newCount };
    }

    function getStats(all) {
        return {
            wins: all.filter(m => m.result === 'win').length,
            losses: all.filter(m => m.result === 'loss').length,
            draws: all.filter(m => m.result === 'draw').length,
        };
    }

    // --- Match Stats Storage ---

    function loadStats() {
        return JSON.parse(GM_getValue('zoe_stats', '[]'));
    }

    function saveStats(newStats) {
        const existing = loadStats();
        const seen = new Set(existing.map(s => s.matchId));
        let added = 0;
        for (const s of newStats) {
            if (!seen.has(s.matchId)) {
                existing.push(s);
                seen.add(s.matchId);
                added++;
            }
        }
        if (added > 0) {
            GM_setValue('zoe_stats', JSON.stringify(existing));
        }
        return { total: existing.length, added };
    }

    function hasStatsForMatch(matchId) {
        const stats = loadStats();
        return stats.some(s => s.matchId === matchId);
    }

    function getMatchesWithoutStats() {
        const allMatches = loadMatches();
        return allMatches.filter(m => m.matchId && m.result !== 'pending' && !hasStatsForMatch(m.matchId));
    }

    function updateStatsBtnVisibility() {
        const statsBtn = document.getElementById('zoe-stats-btn');
        if (!statsBtn) return;
        statsBtn.style.display = getMatchesWithoutStats().length > 0 ? '' : 'none';
    }

    // --- DOM-based ELO extraction ---

    function getEloFromColumn(col) {
        const html = col.innerHTML;
        const m = html.match(/<br>\s*(\d+)/);
        return m ? m[1] : '';
    }

    function extractEloFromMatchRow(dd) {
        const homeCol = dd.querySelector('.home-team-column');
        const awayCol = dd.querySelector('.away-team-column');
        if (!homeCol || !awayCol) return null;

        const homeElo = getEloFromColumn(homeCol);
        const awayElo = getEloFromColumn(awayCol);
        if (!homeElo && !awayElo) return null;

        const scoreLink = dd.querySelector('a[href*="mid="]');
        if (!scoreLink) return null;
        const mMatch = scoreLink.href.match(/mid=(\d+)/);
        if (!mMatch) return null;

        return { matchId: mMatch[1], homeElo, awayElo };
    }

    function applyEloToMatches(eloEntries) {
        if (eloEntries.length === 0) return false;
        const allMatches = loadMatches();
        let updated = false;
        for (const entry of eloEntries) {
            const stored = allMatches.find(m => m.matchId === entry.matchId);
            if (stored) {
                if (entry.homeElo && !stored.homeElo) { stored.homeElo = entry.homeElo; updated = true; }
                if (entry.awayElo && !stored.awayElo) { stored.awayElo = entry.awayElo; updated = true; }
            }
        }
        if (updated) {
            GM_setValue('zoe_matches', JSON.stringify(allMatches));
        }
        return updated;
    }

    function enrichMatchesWithEloFromDOM() {
        const list = document.getElementById('fixtures-results-list');
        if (!list) return;

        const dds = list.querySelectorAll('dd');
        const eloEntries = [];
        dds.forEach(dd => {
            const cls = dd.className || '';
            if (!cls.includes('odd') && !cls.includes('even')) return;
            const entry = extractEloFromMatchRow(dd);
            if (entry) eloEntries.push(entry);
        });

        if (eloEntries.length > 0) {
            const updated = applyEloToMatches(eloEntries);
            if (updated) console.log('ZOE ELO: enriquecidos', eloEntries.length, 'jogos do DOM');
        }
    }

    // --- MutationObserver to capture ELO as it's injected ---

    function startEloObserver() {
        const list = document.getElementById('fixtures-results-list');
        if (!list || list.dataset.zoeObserver) return;
        list.dataset.zoeObserver = '1';

        let debounce = null;
        const observer = new MutationObserver(() => {
            if (debounce) return;
            debounce = setTimeout(() => { debounce = null; }, 1500);
            enrichMatchesWithEloFromDOM();
        });

        observer.observe(list, { childList: true, subtree: true, characterData: true });
    }

    // --- CORE STRATEGY: Fetch match list pages via GM_xmlhttpRequest with pagination ---
    // ELO is NOT in: AJAX responses, individual match pages, storage, network requests.
    // ELO IS in: the rendered match list page HTML (server-side).
    // Each page shows ~25 matches with ELO. We paginate through all pages.

    let lastRawHtml = null;

    function enrichAllMatchesViaGMRequests() {
        const allMatches = loadMatches();
        const missing = allMatches.filter(m => !m.homeElo && !m.awayElo);
        if (missing.length === 0) {
            console.log('ZOE ELO: todos os jogos ja tem ELO');
            return Promise.resolve();
        }

        if (lastRawHtml) {
            const brCount = (lastRawHtml.match(/<br>\s*\d{3,4}/g) || []).length;
            console.log('ZOE ELO DIAG: AJAX HTML padroes <br>\\d+:', brCount);
        }

        console.log('ZOE ELO GM: a buscar paginas do jogo jogado para ELO (' + missing.length + ' jogos sem ELO)...');

        const PER_PAGE = 25;
        const totalPages = Math.ceil(228 / PER_PAGE);
        const eloMap = {};

        return new Promise((resolve) => {
            let page = 0;
            let consecutiveEmpty = 0;

            function fetchPage() {
                const offset = page * PER_PAGE;
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: '/?p=match&sub=played&limit=max&offset=' + offset,
                    onload: function(resp) {
                        try {
                            const text = resp.responseText || '';
                            const brCount = (text.match(/<br>\s*\d{3,4}/g) || []).length;
                            console.log('ZOE ELO GM: pagina ' + (page+1) + '/' + totalPages + ' offset=' + offset + ' tamanho=' + text.length + ' padroes<br>=' + brCount);

                            if (brCount === 0) {
                                consecutiveEmpty++;
                            } else {
                                consecutiveEmpty = 0;
                                const matches = text.match(/<dd class="(odd|even)[\s\S]*?<\/dd>/g) || [];
                                for (const block of matches) {
                                    const homeEloM = block.match(/home-team-column[\s\S]*?<br>\s*(\d+)/);
                                    const awayEloM = block.match(/away-team-column[\s\S]*?<br>\s*(\d+)/);
                                    const midM = block.match(/mid=(\d+)/);
                                    if (midM && (homeEloM || awayEloM)) {
                                        eloMap[midM[1]] = {
                                            homeElo: homeEloM ? homeEloM[1] : '',
                                            awayElo: awayEloM ? awayEloM[1] : ''
                                        };
                                    }
                                }
                            }
                        } catch(e) { console.log('ZOE ELO GM: erro pagina', page, e); }

                        page++;
                        if (page < totalPages && consecutiveEmpty < 3) {
                            setTimeout(fetchPage, 300);
                        } else {
                            finish();
                        }
                    },
                    onerror: function() {
                        page++;
                        if (page < totalPages && consecutiveEmpty < 3) {
                            setTimeout(fetchPage, 300);
                        } else {
                            finish();
                        }
                    }
                });
            }

            function finish() {
                const enriched = Object.keys(eloMap).length;
                if (enriched > 0) {
                    const updated = loadMatches();
                    let changed = false;
                    for (const [matchId, elo] of Object.entries(eloMap)) {
                        const stored = updated.find(m => m.matchId === matchId);
                        if (stored) {
                            if (elo.homeElo && !stored.homeElo) { stored.homeElo = elo.homeElo; changed = true; }
                            if (elo.awayElo && !stored.awayElo) { stored.awayElo = elo.awayElo; changed = true; }
                        }
                    }
                    if (changed) GM_setValue('zoe_matches', JSON.stringify(updated));
                    console.log('ZOE ELO GM: enriquecidos', enriched, 'de', missing.length, 'jogos via paginas');
                } else {
                    console.log('ZOE ELO GM: nenhum ELO encontrado nas paginas do jogo jogado');
                }
                resolve();
            }

            fetchPage();
        });
    }

    function waitForEloEnrichment(maxWaitMs, intervalMs, onDone) {
        maxWaitMs = maxWaitMs || 20000;
        intervalMs = intervalMs || 2000;
        let elapsed = 0;
        const check = () => {
            enrichMatchesWithEloFromDOM();
            startEloObserver();
            const allMatches = loadMatches();
            const hasElo = allMatches.some(m => m.homeElo || m.awayElo);
            elapsed += intervalMs;
            if (hasElo || elapsed >= maxWaitMs) {
                enrichAllMatchesViaGMRequests();
                if (onDone) onDone();
                return;
            }
            setTimeout(check, intervalMs);
        };
        check();
    }

    // --- Team Value extraction from match pages ---
    // Values are injected by the statsxente userscript, so we must load pages
    // in iframes to let the script run, then read the DOM.

    function parseFormattedNumber(str) {
        if (!str) return 0;
        return parseInt(str.replace(/[^0-9]/g, ''), 10) || 0;
    }

    function formatValue(n) {
        if (!n) return '';
        return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }

    function abbreviateValue(n) {
        if (!n) return '';
        const num = typeof n === 'string' ? parseInt(n.replace(/\D/g, ''), 10) : n;
        if (!num) return '';
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1).replace('.', ',') + 'M';
        }
        if (num >= 1000) {
            return Math.round(num / 1000) + 'K';
        }
        return String(num);
    }

    function extractValuesFromIframeDoc(doc) {
        const tables = doc.querySelectorAll('table');
        for (const table of tables) {
            const text = table.textContent || '';
            if (!text.includes('Value')) continue;
            const rows = table.querySelectorAll('tr');
            for (const row of rows) {
                const rowText = row.textContent || '';
                if (!rowText.includes('Value')) continue;
                const tds = row.querySelectorAll('td');
                if (tds.length >= 3) {
                    const homeVal = parseFormattedNumber(tds[1].textContent);
                    const awayVal = parseFormattedNumber(tds[2].textContent);
                    if (homeVal || awayVal) return { homeValue: homeVal, awayValue: awayVal };
                }
            }
        }
        return null;
    }

    function logIframeDebug(doc, mid, attempt) {
        try {
            const tables = doc.querySelectorAll('table');
            const tableCount = tables.length;
            let hasValueTable = false;
            let tableTexts = [];
            for (const t of tables) {
                const txt = (t.textContent || '').substring(0, 200);
                tableTexts.push(txt.replace(/\s+/g, ' ').trim());
                if (txt.includes('Value')) hasValueTable = true;
            }
            const bodyLen = doc.body ? doc.body.innerHTML.length : 0;
            console.log('ZOE VALUE DEBUG: mid=' + mid + ' tentativa=' + attempt + ' bodyLen=' + bodyLen + ' tables=' + tableCount + ' hasValueTable=' + hasValueTable);
            if (tableCount > 0 && !hasValueTable) {
                console.log('ZOE VALUE DEBUG: conteudo das tabelas:', tableTexts);
            }
        } catch (e) {
            console.log('ZOE VALUE DEBUG: mid=' + mid + ' tentativa=' + attempt + ' erro debug:', e.message);
        }
    }

    function fetchMatchPageViaIframe(mid) {
        return new Promise((resolve) => {
            console.log('ZOE VALUE: a carregar mid=' + mid + ' em iframe...');
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;border:none';
            iframe.src = '/?p=match&sub=result&mid=' + mid + '&play=2d&share_sport=soccer';
            document.body.appendChild(iframe);

            let attempts = 0;
            const maxAttempts = 40;

            const check = setInterval(() => {
                attempts++;
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                    if (!doc || !doc.body) return;

                    const result = extractValuesFromIframeDoc(doc);
                    if (result) {
                        clearInterval(check);
                        iframe.remove();
                        console.log('ZOE VALUE: mid=' + mid + ' extraído via iframe:', result);
                        resolve(result);
                        return;
                    }

                    if (attempts % 5 === 0) {
                        logIframeDebug(doc, mid, attempts);
                    }
                } catch (e) {
                    console.log('ZOE VALUE: iframe mid=' + mid + ' tentativa ' + attempts + ' erro:', e.message);
                }

                if (attempts >= maxAttempts) {
                    clearInterval(check);
                    try {
                        const doc = iframe.contentDocument || iframe.contentWindow.document;
                        if (doc) logIframeDebug(doc, mid, 'FINAL');
                    } catch (e) {}
                    iframe.remove();
                    console.log('ZOE VALUE: mid=' + mid + ' timeout no iframe');
                    resolve(null);
                }
            }, 1000);
        });
    }

    async function enrichMatchesWithValues() {
        const allMatches = loadMatches();
        const missing = allMatches.filter(m => m.matchId && m.result !== 'pending' && (!m.homeValue || !m.awayValue));
        if (missing.length === 0) {
            console.log('ZOE VALUE: todos os jogos ja tem valor');
            return;
        }

        console.log('ZOE VALUE: a buscar valores de ' + missing.length + ' jogos via iframe...');
        console.log('ZOE VALUE: jogos sem valor:', missing.map(m => m.matchId + ' (' + m.homeTeam + ' vs ' + m.awayTeam + ')').join(', '));
        const statusEl = document.getElementById('zoe-status');
        if (statusEl) statusEl.innerHTML = `A extrair valores... <span style="color:#aaa">(0/${missing.length})</span>`;

        let done = 0;
        let successCount = 0;
        let failCount = 0;

        for (const m of missing) {
            const result = await fetchMatchPageViaIframe(m.matchId);

            const updated = loadMatches();
            const stored = updated.find(x => x.matchId === m.matchId);
            if (stored && result) {
                if (result.homeValue && !stored.homeValue) { stored.homeValue = String(result.homeValue); }
                if (result.awayValue && !stored.awayValue) { stored.awayValue = String(result.awayValue); }
                GM_setValue('zoe_matches', JSON.stringify(updated));
                successCount++;
            } else {
                failCount++;
            }

            done++;
            if (statusEl) statusEl.innerHTML = `A extrair valores... <span style="color:#aaa">(${done}/${missing.length} | ${successCount} OK, ${failCount} falhou)</span>`;

            await new Promise(r => setTimeout(r, 500));
        }

        console.log('ZOE VALUE: concluído - ' + successCount + ' sucesso, ' + failCount + ' falhados de ' + missing.length);
        if (statusEl) statusEl.innerHTML = `<span style="color:#4caf50">Valores: ${successCount} extraídos, ${failCount} falhados.</span>`;

        const all = loadMatches();
        updateBadgeUI(all);
        updateValueBtnVisibility();
    }

    // --- Match Statistics Extraction ---

    const STATS_COLUMNS = [
        'MatchID', 'TeamSide', 'PlayerID', 'ShirtNumber', 'PlayerName', 'Position', 'Minutes',
        'Goals', 'Assists', 'Shots', 'ShotPct', 'ShotsOnTarget', 'ShotAccuracyPct', 'AutoGoals',
        'Passes', 'SuccessfulPasses', 'FailedPasses', 'PassAccuracyPct', 'AvgPassDist',
        'Interceptions', 'Tackles', 'SuccessfulTackles', 'FailedTackles', 'TacklePct',
        'PossessionMin', 'PossessionPct', 'Distance', 'DistanceWithBall', 'SpeedWithBall', 'RunningSpeed',
        'Corners', 'FreeKicks', 'PenaltiesWon', 'YellowCards', 'RedCards', 'Saves'
    ];

    const TEAM_SUMMARY_COLUMNS = [
        'MatchID', 'TeamSide', 'TeamName', 'Goals', 'RedCards', 'ShotsOnTarget', 'PossessionPct', 'AvgAge'
    ];

    function debugDumpFirstRow(doc) {
        try {
            const statsTab = doc.querySelector('#match-statistics');
            if (!statsTab) return;
            const detailedTable = statsTab.querySelector('table.matchStats--detailed');
            if (!detailedTable) return;
            const rows = detailedTable.querySelectorAll('tr');
            for (const row of rows) {
                const cells = row.querySelectorAll('td');
                if (cells.length < 10) continue;
                const playerLink = row.querySelector('a[href*="pid="]');
                if (!playerLink) continue;
                const debugCells = [];
                for (let i = 0; i < cells.length; i++) {
                    debugCells.push(`[${i}]="${cells[i].textContent.trim()}"`);
                }
                console.log('ZOE STATS DEBUG: Jogador:', playerLink.textContent.trim(), '| Total cells:', cells.length);
                console.log('ZOE STATS DEBUG: Todas as cells:', debugCells.join(' '));
                break;
            }
            const h2s = statsTab.querySelectorAll('h2');
            console.log('ZOE STATS DEBUG: h2 count:', h2s.length, 'home:', h2s[0]?.textContent?.trim(), 'away:', h2s[1]?.textContent?.trim());
        } catch (e) {
            console.log('ZOE STATS DEBUG: erro', e.message);
        }
    }

    function parseMatchStatsFromDoc(doc, matchId) {
        try {
            const statsTab = doc.querySelector('#match-statistics');
            if (!statsTab) {
                console.log('ZOE STATS PARSE: #match-statistics não encontrado');
                return null;
            }
            console.log('ZOE STATS PARSE: encontrou #match-statistics');

            debugDumpFirstRow(doc);

            const teamHeaders = statsTab.querySelectorAll('h2');
            const homeName = teamHeaders[0] ? teamHeaders[0].textContent.trim() : '';
            const awayName = teamHeaders[1] ? teamHeaders[1].textContent.trim() : '';
            console.log('ZOE STATS PARSE: equipas:', homeName, 'vs', awayName);

            const summaryRows = statsTab.querySelectorAll('table tr');
            const teamSummaries = [];
            for (const row of summaryRows) {
                const cells = row.querySelectorAll('td');
                if (cells.length < 2) continue;
                const label = cells[0].textContent.trim().toLowerCase();
                if (label.includes('golo') || label.includes('goal')) {
                    const vals = [];
                    for (let i = 1; i < cells.length; i++) vals.push(cells[i].textContent.trim());
                    if (vals.length >= 2) {
                        teamSummaries.push({ metric: 'Goals', home: vals[0], away: vals[vals.length - 1] });
                    }
                }
                if (label.includes('cart') || label.includes('red')) {
                    const vals = [];
                    for (let i = 1; i < cells.length; i++) vals.push(cells[i].textContent.trim());
                    if (vals.length >= 2) {
                        teamSummaries.push({ metric: 'RedCards', home: vals[0], away: vals[vals.length - 1] });
                    }
                }
                if (label.includes('remate') || label.includes('shot')) {
                    const vals = [];
                    for (let i = 1; i < cells.length; i++) vals.push(cells[i].textContent.trim());
                    if (vals.length >= 2) {
                        teamSummaries.push({ metric: 'ShotsOnTarget', home: vals[0], away: vals[vals.length - 1] });
                    }
                }
                if (label.includes('posse') || label.includes('poss')) {
                    const vals = [];
                    for (let i = 1; i < cells.length; i++) vals.push(cells[i].textContent.trim());
                    if (vals.length >= 2) {
                        teamSummaries.push({ metric: 'PossessionPct', home: vals[0], away: vals[vals.length - 1] });
                    }
                }
                if (label.includes('idade') || label.includes('age')) {
                    const vals = [];
                    for (let i = 1; i < cells.length; i++) vals.push(cells[i].textContent.trim());
                    if (vals.length >= 2) {
                        teamSummaries.push({ metric: 'AvgAge', home: vals[0], away: vals[vals.length - 1] });
                    }
                }
            }

            const summaryMap = {};
            for (const s of teamSummaries) {
                summaryMap[s.metric] = { home: s.home, away: s.away };
            }

            const detailedTables = statsTab.querySelectorAll('table.matchStats--detailed');
            console.log('ZOE STATS PARSE: tabelas matchStats--detailed:', detailedTables.length);

            if (detailedTables.length === 0) {
                console.log('ZOE STATS PARSE: tabela detalhada não encontrada');
                return null;
            }

            const allPlayerStats = [];

            for (let tIdx = 0; tIdx < detailedTables.length; tIdx++) {
                const detailedTable = detailedTables[tIdx];
                const side = tIdx === 0 ? 'home' : 'away';
                const rows = detailedTable.querySelectorAll('tr');

                for (const row of rows) {
                    const cells = row.querySelectorAll('td');
                    if (cells.length < 10) continue;

                    let playerLink = row.querySelector('a[href*="pid="]');
                    if (!playerLink) {
                        const firstCell = cells[0];
                        const links = firstCell.querySelectorAll('a');
                        for (const l of links) {
                            if ((l.getAttribute('href') || '').includes('pid=')) {
                                playerLink = l;
                                break;
                            }
                        }
                    }
                    if (!playerLink) continue;

                    let pid = '';
                    const href = playerLink.getAttribute('href') || '';
                    const pidMatch = href.match(/pid=(\d+)/);
                    if (pidMatch) pid = pidMatch[1];

                    const shirtEl = row.querySelector('.player-label__number, .player-number');
                    const shirtNumber = shirtEl ? shirtEl.textContent.trim() : '';

                    const playerName = playerLink.textContent.trim();

                    const posEl = cells[1];
                    const position = posEl ? posEl.textContent.trim() : '';

                    const vals = [];
                    for (let i = 2; i < cells.length; i++) {
                        vals.push(cells[i].textContent.trim());
                    }

                    allPlayerStats.push({
                        matchId,
                        teamSide: side,
                        playerID: pid,
                        shirtNumber,
                        playerName,
                        position,
                        minutes: vals[0] || '',
                        goals: vals[1] || '',
                        assists: vals[2] || '',
                        shots: vals[3] || '',
                        shotPct: vals[4] || '',
                        shotsOnTarget: vals[5] || '',
                        shotAccuracyPct: vals[6] || '',
                        autoGoals: vals[7] || '',
                        passes: vals[8] || '',
                        successfulPasses: vals[9] || '',
                        failedPasses: vals[10] || '',
                        passAccuracyPct: vals[11] || '',
                        avgPassDist: vals[12] || '',
                        interceptions: vals[13] || '',
                        tackles: vals[14] || '',
                        successfulTackles: vals[15] || '',
                        failedTackles: vals[16] || '',
                        tacklePct: vals[17] || '',
                        possessionMin: vals[18] || '',
                        possessionPct: vals[19] || '',
                        distance: vals[20] || '',
                        distanceWithBall: vals[21] || '',
                        speedWithBall: vals[22] || '',
                        runningSpeed: vals[23] || '',
                        corners: vals[24] || '',
                        freeKicks: vals[25] || '',
                        penaltiesWon: vals[26] || '',
                        yellowCards: vals[27] || '',
                        redCards: vals[28] || '',
                        saves: vals[29] || ''
                    });
                }
            }

            console.log('ZOE STATS PARSE: jogadores extraídos:', allPlayerStats.length);

            const teamSummaryStats = [];
            for (const [side, name] of [['home', homeName], ['away', awayName]]) {
                teamSummaryStats.push({
                    matchId,
                    teamSide: side,
                    teamName: name,
                    goals: summaryMap.Goals ? summaryMap.Goals[side] : '',
                    redCards: summaryMap.RedCards ? summaryMap.RedCards[side] : '',
                    shotsOnTarget: summaryMap.ShotsOnTarget ? summaryMap.ShotsOnTarget[side] : '',
                    possessionPct: summaryMap.PossessionPct ? summaryMap.PossessionPct[side] : '',
                    avgAge: summaryMap.AvgAge ? summaryMap.AvgAge[side] : ''
                });
            }

            return { matchId, playerStats: allPlayerStats, teamSummaryStats };
        } catch (e) {
            console.error('ZOE STATS: erro ao extrair stats do documento:', e);
            return null;
        }
    }

    function extractMatchStatsFromIframe(mid) {
        return new Promise((resolve) => {
            console.log('ZOE STATS: a carregar mid=' + mid + ' em iframe...');
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;border:none';
            iframe.src = '/?p=match&sub=result&mid=' + mid + '&play=2d&share_sport=soccer';
            document.body.appendChild(iframe);

            let attempts = 0;
            const maxAttempts = 45;

            const check = setInterval(() => {
                attempts++;
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                    if (!doc || !doc.body) return;

                    const bodyLen = doc.body.innerHTML.length;
                    if (bodyLen < 5000) return;

                    const detailedTable = doc.querySelector('#match-statistics table.matchStats--detailed');
                    if (!detailedTable) {
                        if (attempts < maxAttempts) return;
                        console.log('ZOE STATS: matchStats--detailed não encontrado no DOM');
                        clearInterval(check);
                        iframe.remove();
                        resolve(null);
                        return;
                    }

                    clearInterval(check);
                    console.log('ZOE STATS: matchStats--detailed encontrado, a extrair...');
                    const result = parseMatchStatsFromDoc(doc, mid);
                    iframe.remove();
                    if (result && result.playerStats.length > 0) {
                        console.log('ZOE STATS: mid=' + mid + ' extraído com sucesso (' + result.playerStats.length + ' jogadores)');
                    } else {
                        console.log('ZOE STATS: mid=' + mid + ' parse retornou vazio');
                    }
                    resolve(result);
                } catch (e) {
                    console.log('ZOE STATS: iframe mid=' + mid + ' erro:', e.message);
                    if (attempts >= maxAttempts) {
                        clearInterval(check);
                        iframe.remove();
                        resolve(null);
                    }
                }
            }, 1000);
        });
    }

    async function extractLastNMatchStats(n) {
        const allMatches = loadMatches();
        const matchesWithId = allMatches.filter(m => m.matchId && m.result !== 'pending');
        const matchesNeedingStats = matchesWithId.filter(m => !hasStatsForMatch(m.matchId));
        const toExtract = matchesNeedingStats.slice(0, n);

        if (toExtract.length === 0) {
            console.log('ZOE STATS: todos os jogos já têm estatísticas');
            return { extracted: 0, failed: 0 };
        }

        console.log('ZOE STATS: a extrair estatísticas de ' + toExtract.length + ' jogos...');
        const statusEl = document.getElementById('zoe-status');
        if (statusEl) statusEl.innerHTML = `A extrair estatísticas... <span style="color:#aaa">(0/${toExtract.length})</span>`;

        let extracted = 0;
        let failed = 0;

        for (const m of toExtract) {
            const result = await extractMatchStatsFromIframe(m.matchId);
            if (result && result.playerStats.length > 0) {
                saveStats([{
                    matchId: m.matchId,
                    date: m.date,
                    homeTeam: m.homeTeam,
                    awayTeam: m.awayTeam,
                    homeScore: m.homeScore,
                    awayScore: m.awayScore,
                    playerStats: result.playerStats,
                    teamSummaryStats: result.teamSummaryStats
                }]);
                extracted++;
            } else {
                failed++;
            }

            const done = extracted + failed;
            if (statusEl) statusEl.innerHTML = `A extrair estatísticas... <span style="color:#aaa">(${done}/${toExtract.length} | ${extracted} OK, ${failed} falhou)</span>`;

            await new Promise(r => setTimeout(r, 800));
        }

        console.log('ZOE STATS: concluído - ' + extracted + ' sucesso, ' + failed + ' falhados');
        if (statusEl) statusEl.innerHTML = `<span style="color:#4caf50">Estatísticas: ${extracted} extraídas, ${failed} falhadas.</span>`;

        updateStatsBtnVisibility();
        return { extracted, failed };
    }

    // --- Season ---
    const SEASON_REF_DATE = new Date(2026, 5, 30);
    const SEASON_REF_NUM = 99;
    const SEASON_DAYS = 91;

    function getSeason(dateStr) {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length !== 3) return '';
        const d = new Date(+parts[2], +parts[1] - 1, +parts[0]);
        const diffDays = Math.floor((d - SEASON_REF_DATE) / (1000 * 60 * 60 * 24));
        return SEASON_REF_NUM + Math.floor(diffDays / SEASON_DAYS);
    }

    // --- Category ---
    const TACTIC_TO_CATEGORY = {
        'AA': 'Senior', 'AA_JL': 'Senior', 'xJL': 'Senior', 'xJL_JL': 'Senior',
        'x3J': 'Senior', 'x3J_JL': 'Senior', '4D': 'Senior', '4D_JL': 'Senior',
        'U23': 'U23', 'U23_JL': 'U23', 'xJ_U23': 'U23', 'U23xJJ': 'U23',
        'U21': 'U21', 'U21_JL': 'U21', 'xJ_U21': 'U21',
        'U18': 'U18',
        'Le/Su1': 'Desconhecido', 'Le/Su2': 'Desconhecido', 'Le/Su3': 'Desconhecido',
    };

    function detectCategory(type, competition, tactic) {
        if (type === 'Amigável') return 'Outros';
        return TACTIC_TO_CATEGORY[tactic] || 'Desconhecido';
    }

    const CATEGORIES = ['Senior', 'U23', 'U21', 'U18', 'Outros', 'Desconhecido'];
    const TACTICS = ['AA', 'AA_JL', 'xJL', 'xJL_JL', 'x3J', 'x3J_JL', '4D', '4D_JL', 'U23', 'U23_JL', 'xJ_U23', 'U23xJJ', 'U21', 'U21_JL', 'xJ_U21', 'U18', 'Le/Su1', 'Le/Su2', 'Le/Su3'];
    const EDITABLE_TACTICS = ['Le/Su1', 'Le/Su2', 'Le/Su3'];

    function getMatchTactic(m) {
        return m.customTactic || m.tactic || '';
    }

    function getMatchCategory(m) {
        const tactic = getMatchTactic(m);
        if (m.customCategory) return m.customCategory;
        if (m.type === 'Amigável') return 'Outros';
        return TACTIC_TO_CATEGORY[tactic] || 'Desconhecido';
    }

    function setMatchCategory(matchId, newCategory) {
        const all = loadMatches();
        const m = all.find(x => x.matchId === matchId);
        if (m) {
            m.customCategory = newCategory;
            GM_setValue('zoe_matches', JSON.stringify(all));
        }
    }

    function setMatchTactic(matchId, newTactic) {
        const all = loadMatches();
        const m = all.find(x => x.matchId === matchId);
        if (m) {
            m.customTactic = newTactic;
            GM_setValue('zoe_matches', JSON.stringify(all));
        }
    }

    function removeNonTeamMatches() {
        const all = loadMatches();
        const before = all.length;
        const filtered = all.filter(m => {
            const tactic = m.customTactic || m.tactic || '';
            return tactic !== '';
        });
        const removed = before - filtered.length;
        if (removed > 0) {
            GM_setValue('zoe_matches', JSON.stringify(filtered));
        }
        return { before, after: filtered.length, removed };
    }

    function sortMatchesByDate(matches) {
        return matches.sort((a, b) => {
            const da = a.date ? a.date.split('-').reverse().join('') : '';
            const db = b.date ? b.date.split('-').reverse().join('') : '';
            if (da !== db) return db.localeCompare(da);
            const ta = a.time || '';
            const tb = b.time || '';
            return tb.localeCompare(ta);
        });
    }

    // --- Background polling ---
    let lastFetchTime = 0;
    let pollTimer = null;

    async function pollMatches() {
        const statusEl = document.getElementById('zoe-status');
        if (statusEl) statusEl.textContent = 'A buscar jogos...';
        const matches = await fetchAndParseMatches();
        if (!matches) {
            if (statusEl) statusEl.innerHTML = '<span style="color:#ff9800">ZOE: erro ao contactar servidor.</span>';
            return;
        }
        if (matches.length === 0) {
            if (statusEl) statusEl.textContent = 'Nenhum jogo encontrado.';
            return;
        }
        const { all, new: newCount } = saveMatches(matches);
        lastFetchTime = Date.now();

        enrichMatchesWithEloFromDOM();

        if (newCount > 0) {
            updateStatusUI(all, newCount);
        }
        updateBadgeUI(all);
        updateEloBtnVisibility();
        updateValueBtnVisibility();
        if (statusEl && newCount === 0) {
            updateStatusUI(all, 0);
        }
    }

    // --- UI ---
    function updateStatusUI(all, newCount) {
        const statusEl = document.getElementById('zoe-status');
        if (!statusEl) return;
        const visible = getVisibleMatches(all);
        const stats = { wins: visible.filter(m => m.result === 'win').length, losses: visible.filter(m => m.result === 'loss').length, draws: visible.filter(m => m.result === 'draw').length };
        const newBadge = newCount ? `(<span style="color:#4caf50">+${newCount} novos</span>)` : '';
        statusEl.innerHTML = `
            <strong>ZOE:</strong> ${visible.length} jogos guardados ${newBadge}
            <br>(${stats.wins} V / ${stats.draws} E / ${stats.losses} D)
            <br><small>Última verificação: ${new Date(lastFetchTime).toLocaleTimeString('pt-PT')}</small>
            <br><small><a href="#" id="zoe-show-data">Ver detalhes</a></small>
        `;
    }

    let badgeEl = null;

    function updateBadgeUI(all) {
        if (document.getElementById('zoe-container')) return;
        if (!badgeEl) {
            badgeEl = document.createElement('div');
            badgeEl.id = 'zoe-badge';
            badgeEl.title = 'ZOE - Clique para ver detalhes';
            badgeEl.style.cssText = `
                position: fixed; bottom: 8px; right: 8px; z-index: 999999;
                background: #1a1a2e; color: #eee; border: 1px solid #e94560;
                border-radius: 20px; padding: 4px 12px; font: 12px Arial, sans-serif;
                cursor: pointer; opacity: 0.85; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            `;
            badgeEl.addEventListener('click', showDataPanel);
            document.body.appendChild(badgeEl);
        }
        const visible = getVisibleMatches(all);
        const stats = { wins: visible.filter(m => m.result === 'win').length, losses: visible.filter(m => m.result === 'loss').length, draws: visible.filter(m => m.result === 'draw').length };
        badgeEl.textContent = `ZOE: ${visible.length} jogos (${stats.wins}V ${stats.draws}E ${stats.losses}D)`;
    }

    function injectUI() {
        const target = document.querySelector('#fixtures-results-list-wrapper');
        if (!target) return;
        if (document.getElementById('zoe-container')) return;

        const container = document.createElement('div');
        container.id = 'zoe-container';
        container.style.cssText = 'margin: 8px 0; padding: 8px 12px; background: #1a1a2e; border: 1px solid #e94560; border-radius: 6px; color: #eee; font-size: 13px; display: flex; align-items: center; gap: 12px;';

        const label = document.createElement('strong');
        label.style.color = '#e94560';
        label.textContent = 'ZOE';
        container.appendChild(label);

        const btn = document.createElement('button');
        btn.id = 'zoe-extract-btn';
        btn.textContent = 'Buscar agora';
        btn.style.cssText = 'background: #e94560; color: white; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer;';
        container.appendChild(btn);

        const eloBtn = document.createElement('button');
        eloBtn.id = 'zoe-elo-btn';
        eloBtn.textContent = 'Extrair ELO';
        eloBtn.style.cssText = 'background: #16213e; color: #e94560; border: 1px solid #e94560; padding: 4px 12px; border-radius: 4px; cursor: pointer;';
        container.appendChild(eloBtn);

        const valueBtn = document.createElement('button');
        valueBtn.id = 'zoe-value-btn';
        valueBtn.textContent = 'Extrair Valores';
        valueBtn.style.cssText = 'background: #16213e; color: #e94560; border: 1px solid #e94560; padding: 4px 12px; border-radius: 4px; cursor: pointer;';
        container.appendChild(valueBtn);

        const statsBtn = document.createElement('button');
        statsBtn.id = 'zoe-stats-btn';
        statsBtn.textContent = 'Extrair Stats';
        statsBtn.style.cssText = 'background: #16213e; color: #e94560; border: 1px solid #e94560; padding: 4px 12px; border-radius: 4px; cursor: pointer;';
        container.appendChild(statsBtn);

        const backupBtn = document.createElement('button');
        backupBtn.id = 'zoe-backup-btn';
        backupBtn.textContent = '☁ Backup';
        backupBtn.style.cssText = 'background: #0f3460; color: #4caf50; border: 1px solid #4caf50; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;';
        container.appendChild(backupBtn);

        const status = document.createElement('span');
        status.id = 'zoe-status';
        status.textContent = 'A iniciar...';
        container.appendChild(status);

        const viewLink = document.createElement('a');
        viewLink.id = 'zoe-view-data';
        viewLink.textContent = 'Ver dados';
        viewLink.href = '#';
        viewLink.style.cssText = 'color: #e94560; margin-left: auto;';
        container.appendChild(viewLink);

        const playersLink = document.createElement('a');
        playersLink.id = 'zoe-view-players';
        playersLink.textContent = 'Ver jogadores';
        playersLink.href = '#';
        playersLink.style.cssText = 'color: #e94560; margin-left: 8px;';
        container.appendChild(playersLink);

        target.parentNode.insertBefore(container, target);

        btn.onclick = async () => {
            const statusEl = document.getElementById('zoe-status');
            if (statusEl) statusEl.textContent = 'A buscar jogos...';
            await pollMatches();
            waitForEloEnrichment();
            enrichMatchesWithValues();
            if (statusEl) statusEl.textContent = 'Concluído.';
        };
        eloBtn.onclick = () => {
            const statusEl = document.getElementById('zoe-status');
            const eloEntries = [];
            const dds = document.querySelectorAll('#fixtures-results-list dd.odd, #fixtures-results-list dd.even');
            dds.forEach(dd => {
                const entry = extractEloFromMatchRow(dd);
                if (entry) eloEntries.push(entry);
            });
            if (eloEntries.length > 0) {
                const updated = applyEloToMatches(eloEntries);
                if (updated) {
                    if (statusEl) statusEl.innerHTML = `<span style="color:#4caf50">ELO: ${eloEntries.length} jogos extraídos do DOM, dados atualizados.</span>`;
                } else {
                    if (statusEl) statusEl.innerHTML = `ELO: ${eloEntries.length} jogos lidos, mas sem alterações (já estavam guardados).`;
                }
            } else {
                if (statusEl) statusEl.innerHTML = '<span style="color:#ff9800">ELO: nenhum dado encontrado no DOM. Certifica-te que estás na página "Jogos realizados" com o intervalo em "Máximo".</span>';
            }
            console.log('ZOE ELO manual: extraídos', eloEntries.length, 'registos do DOM');
            const all = loadMatches();
            updateBadgeUI(all);
            updateEloBtnVisibility();
            updateValueBtnVisibility();
        };
        valueBtn.onclick = () => enrichMatchesWithValues();
        statsBtn.onclick = async () => {
            const statusEl = document.getElementById('zoe-status');
            if (statusEl) statusEl.textContent = 'A extrair estatísticas...';
            const result = await extractLastNMatchStats(5);
            if (statusEl) statusEl.innerHTML = `<span style="color:#4caf50">Estatísticas: ${result.extracted} extraídas, ${result.failed} falhadas.</span>`;
            const all = loadMatches();
            updateBadgeUI(all);
            updateStatsBtnVisibility();
        };
        backupBtn.onclick = async () => {
            if (!isTeraboxConfigured()) {
                showTeraboxConfigDialog();
                return;
            }
            const statusEl = document.getElementById('zoe-status');
            if (statusEl) statusEl.textContent = 'A fazer backup para TeraBox...';
            try {
                const result = await backupToTerabox();
                if (result.errors.length === 0) {
                    if (statusEl) statusEl.innerHTML = '<span style="color:#4caf50">Backup TeraBox: ' + result.uploaded + ' ficheiro(s) enviado(s)!</span>';
                    if (typeof GM_notification !== 'undefined') {
                        GM_notification({ title: 'ZOE', text: 'Backup TeraBox concluído (' + result.uploaded + ' ficheiros)', timeout: 5000 });
                    }
                } else {
                    if (statusEl) statusEl.innerHTML = '<span style="color:#ff9800">Backup TeraBox: ' + result.uploaded + ' OK, ' + result.errors.length + ' erro(s). Ver consola.</span>';
                    console.warn('ZOE Backup erros:', result.errors);
                }
            } catch(e) {
                if (statusEl) statusEl.innerHTML = '<span style="color:#f44336">Erro no backup: ' + e.message + '</span>';
            }
        };
        viewLink.onclick = (e) => { e.preventDefault(); showDataPanel(); };
        playersLink.onclick = (e) => { e.preventDefault(); showPlayersPanel(); };
        updateEloBtnVisibility();
        updateValueBtnVisibility();
        updateStatsBtnVisibility();
    }

    const panelFilters = {
        season: '', type: '', competition: '', category: '', homeTeam: '', awayTeam: '', tactic: '', result: ''
    };

    function getUniqueValues(matches, getter) {
        const vals = new Set();
        matches.forEach(m => { const v = getter(m); if (v) vals.add(v); });
        return [...vals].sort((a, b) => String(a).localeCompare(String(b), 'pt-PT'));
    }

    function buildFilterSelect(id, options, placeholder) {
        let html = `<select id="${id}" style="width:100%;font-size:10px;padding:1px 0;background:#0f3460;color:#eee;border:1px solid #333;border-radius:2px;cursor:pointer"><option value="">${placeholder}</option>`;
        options.forEach(o => {
            html += `<option value="${o}">${o}</option>`;
        });
        return html + '</select>';
    }

    function applyFilters(matches) {
        return matches.filter(m => {
            const season = String(m.season || getSeason(m.date));
            const category = getMatchCategory(m);
            const competition = m.competition || '';
            const tactic = getMatchTactic(m);
            const home = m.homeTeam || '';
            const away = m.awayTeam || '';
            const result = m.result || '';
            if (panelFilters.season && season !== panelFilters.season) return false;
            if (panelFilters.type && m.type !== panelFilters.type) return false;
            if (panelFilters.competition && competition !== panelFilters.competition) return false;
            if (panelFilters.category && category !== panelFilters.category) return false;
            if (panelFilters.homeTeam && !home.toLowerCase().includes(panelFilters.homeTeam.toLowerCase())) return false;
            if (panelFilters.awayTeam && !away.toLowerCase().includes(panelFilters.awayTeam.toLowerCase())) return false;
            if (panelFilters.tactic && tactic !== panelFilters.tactic) return false;
            if (panelFilters.result && result !== panelFilters.result) return false;
            return true;
        });
    }

    function showDataPanel() {
        const allMatches = loadMatches();
        if (allMatches.length === 0) {
            alert('Nenhum jogo guardado ainda.');
            return;
        }

        const visibleMatches = sortMatchesByDate(getVisibleMatches(allMatches));
        const filteredMatches = applyFilters(visibleMatches);
        const totalAll = allMatches.length;
        const totalVisible = visibleMatches.length;
        const totalFiltered = filteredMatches.length;
        const recentCount = totalAll - totalVisible;
        const hasFilters = Object.values(panelFilters).some(v => v !== '');

        const seasons = getUniqueValues(visibleMatches, m => String(m.season || getSeason(m.date)));
        const types = getUniqueValues(visibleMatches, m => m.type);
        const competitions = getUniqueValues(visibleMatches, m => m.competition);
        const categories = getUniqueValues(visibleMatches, m => getMatchCategory(m));
        const homeTeams = getUniqueValues(visibleMatches, m => m.homeTeam);
        const awayTeams = getUniqueValues(visibleMatches, m => m.awayTeam);
        const tactics = getUniqueValues(visibleMatches, m => m.tactic);
        const results = getUniqueValues(visibleMatches, m => m.result);

        const totalLabel = showRecentResults
            ? `<strong>Total: ${hasFilters ? totalFiltered + ' / ' : ''}${totalAll} jogos</strong>`
            : `<strong>Total: ${hasFilters ? totalFiltered + ' / ' : ''}${totalVisible} jogos</strong>${recentCount > 0 ? ` <span style="color:#aaa">(+${recentCount} últimos 24h ocultos)</span>` : ''}`;

        const selStyle = 'width:100%;font-size:10px;padding:1px 0;background:#0f3460;color:#eee;border:1px solid #333;border-radius:2px;cursor:pointer';
        const thStyle = 'padding:4px;border-bottom:1px solid #e94560;color:#fff';

        const panel = document.createElement('div');
        panel.id = 'zoe-panel';
        panel.style.cssText = `
            position: fixed; top: 10px; right: 10px; width: 950px; max-height: 90vh;
            background: #1a1a2e; color: #eee; border: 1px solid #e94560; border-radius: 8px;
            padding: 16px; font-size: 12px; z-index: 999999; overflow-y: auto;
            font-family: Arial, sans-serif; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        `;
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid #e94560;padding-bottom:8px">
                <strong style="font-size:14px;color:#e94560">ZOE - Dados Guardados</strong>
                <span style="cursor:pointer;font-size:18px" id="zoe-panel-close">&times;</span>
            </div>
            <div style="margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                ${totalLabel}
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;color:#aaa;font-size:12px">
                    <input type="checkbox" id="zoe-show-recent" ${showRecentResults ? 'checked' : ''} style="cursor:pointer"> Mostrar resultados
                </label>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;color:#aaa;font-size:12px">
                    <input type="checkbox" id="zoe-edit-mode" ${editMode ? 'checked' : ''} style="cursor:pointer"> Alterar Dados
                </label>
                ${hasFilters ? '<button id="zoe-clear-filters" style="background:#555;color:white;border:none;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px">Limpar filtros</button>' : ''}
                <button id="zoe-csv-btn" style="background:#16213e;color:#e94560;border:1px solid #e94560;padding:2px 8px;border-radius:4px;cursor:pointer">Importar/Exportar</button>
                <button id="zoe-remove-others" style="background:#ff5722;color:white;border:none;padding:2px 8px;border-radius:4px;cursor:pointer">Remover Outros</button>
                <button id="zoe-clear-data" style="background:#555;color:white;border:none;padding:2px 8px;border-radius:4px;cursor:pointer">Limpar</button>
                <button id="zoe-stats-csv-btn" style="background:#16213e;color:#e94560;border:1px solid #e94560;padding:2px 8px;border-radius:4px;cursor:pointer">Stats CSV</button>
                <button id="zoe-clear-stats" style="background:#555;color:white;border:none;padding:2px 8px;border-radius:4px;cursor:pointer">Limpar Stats</button>
                <button id="zoe-tb-config" style="background:#0f3460;color:#4caf50;border:1px solid #4caf50;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px">☁ TeraBox</button>
                ${isTeraboxConfigured() ? '<span style="color:#4caf50;font-size:10px">✓</span>' : '<span style="color:#ff9800;font-size:10px" title="Não configurado">⚠</span>'}
            </div>
            <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;color:#fff">
                <thead>
                    <tr style="background:#16213e;font-size:10px">
                        <th style="${thStyle}text-align:left;width:70px"></th>
                        <th style="${thStyle}text-align:center;width:30px">${buildFilterSelect('zoe-f-season', seasons, 'S')}</th>
                        <th style="${thStyle}text-align:left;width:100px">${buildFilterSelect('zoe-f-type', types, 'Tipo')}</th>
                        <th style="${thStyle}text-align:left;width:100px">${buildFilterSelect('zoe-f-comp', competitions, 'Competição')}</th>
                        <th style="${thStyle}text-align:center;width:60px">${buildFilterSelect('zoe-f-cat', categories, 'Categoria')}</th>
                        <th style="${thStyle}text-align:center;width:60px">Valor</th>
                        <th style="${thStyle}text-align:center;width:45px">ELO</th>
                        <th style="${thStyle}text-align:left;width:100px">${buildFilterSelect('zoe-f-home', homeTeams, 'Casa')}</th>
                        <th style="${thStyle}text-align:center;width:50px">${buildFilterSelect('zoe-f-result', results, 'Resultado')}</th>
                        <th style="${thStyle}text-align:left;width:100px">${buildFilterSelect('zoe-f-away', awayTeams, 'Fora')}</th>
                        <th style="${thStyle}text-align:center;width:45px">ELO</th>
                        <th style="${thStyle}text-align:center;width:60px">Valor</th>
                        <th style="${thStyle}text-align:center;width:60px">${buildFilterSelect('zoe-f-tactic', tactics, 'Tática')}</th>
                    </tr>
                    <tr style="background:#16213e">
                        <th style="${thStyle}text-align:left">Data</th>
                        <th style="${thStyle}text-align:center">S</th>
                        <th style="${thStyle}text-align:left">Tipo</th>
                        <th style="${thStyle}text-align:left">Competição</th>
                        <th style="${thStyle}text-align:left">Categoria</th>
                        <th style="${thStyle}text-align:center">Valor</th>
                        <th style="${thStyle}text-align:center">ELO</th>
                        <th style="${thStyle}text-align:left">Casa</th>
                        <th style="${thStyle}text-align:center">Result</th>
                        <th style="${thStyle}text-align:left">Fora</th>
                        <th style="${thStyle}text-align:center">ELO</th>
                        <th style="${thStyle}text-align:center">Valor</th>
                        <th style="${thStyle}text-align:center">Tática</th>
                    </tr>
                </thead>
                <tbody>
                    ${filteredMatches.map(m => {
                        const category = getMatchCategory(m);
                        const tactic = getMatchTactic(m);
                        const catColor = category === 'Senior' ? '#4caf50' : category === 'U23' ? '#2196f3' : category === 'U21' ? '#ff9800' : category === 'U18' ? '#e91e63' : category === 'Outros' ? '#9e9e9e' : '#ff5722';
                        const compDisplay = m.competition ? `${m.competition}` : '-';
                        const hidden = !showRecentResults && isLast24h(m);
                        const displayScore = m.result === 'pending' ? 'vs' : hidden ? '?-?' : `${m.homeScore}-${m.awayScore}`;
                        const resultColor = hidden ? '#666' : m.result === 'win' ? '#4caf50' : m.result === 'loss' ? '#f44336' : '#ffeb3b';
                        return `<tr style="${hidden ? 'opacity:0.5' : ''}">
                            <td style="padding:3px;border-bottom:1px solid #333;color:#fff;white-space:nowrap">${m.date || ''}<br><small style="color:#aaa">${m.time || ''}</small></td>
                            <td style="padding:3px;border-bottom:1px solid #333;color:#fff;text-align:center;font-weight:bold">${m.season || getSeason(m.date)}</td>
                            <td style="padding:3px;border-bottom:1px solid #333;color:#fff">${m.type}</td>
                            <td style="padding:3px;border-bottom:1px solid #333;color:#fff;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${compDisplay}">${compDisplay}</td>
                            <td style="padding:3px;border-bottom:1px solid #333;text-align:center">${(editMode && m.category === 'Desconhecido') ? `<select class="zoe-cat-select" data-mid="${m.matchId}" style="background:transparent;color:${catColor};font-weight:bold;border:none;font-size:12px;cursor:pointer;text-align:center">${CATEGORIES.map(c => `<option value="${c}"${c === category ? ' selected' : ''}>${c}</option>`).join('')}</select>` : `<span style="color:${catColor};font-weight:bold">${category}</span>`}</td>
                            <td style="padding:3px;border-bottom:1px solid #333;color:#aaa;text-align:center;font-size:10px" title="${formatValue(m.homeValue)}">${abbreviateValue(m.homeValue)}</td>
                            <td style="padding:3px;border-bottom:1px solid #333;color:#aaa;text-align:center">${m.homeElo || ''}</td>
                            <td style="padding:3px;border-bottom:1px solid #333;color:#fff;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${m.homeTeam}">${m.homeTeam}</td>
                            <td style="padding:3px;border-bottom:1px solid #333;text-align:center;font-weight:bold;color:${resultColor}">${m.matchId && m.result !== 'pending' && !hidden ? `<a href="https://www.managerzone.com/?p=match&sub=result&mid=${m.matchId}" target="_blank" style="color:inherit;text-decoration:none;border-bottom:1px dashed currentColor">${displayScore}</a>` : displayScore}</td>
                            <td style="padding:3px;border-bottom:1px solid #333;color:#fff;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${m.awayTeam}">${m.awayTeam}</td>
                            <td style="padding:3px;border-bottom:1px solid #333;color:#aaa;text-align:center">${m.awayElo || ''}</td>
                            <td style="padding:3px;border-bottom:1px solid #333;color:#aaa;text-align:center;font-size:10px" title="${formatValue(m.awayValue)}">${abbreviateValue(m.awayValue)}</td>
                            <td style="padding:3px;border-bottom:1px solid #333;color:#fff;text-align:center">${(editMode && EDITABLE_TACTICS.includes(m.tactic)) ? `<select class="zoe-tac-select" data-mid="${m.matchId}" style="background:transparent;color:#fff;border:none;font-size:12px;cursor:pointer;text-align:center">${TACTICS.map(t => `<option value="${t}"${t === tactic ? ' selected' : ''}>${t}</option>`).join('')}</select>` : (tactic || '')}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            </div>
        `;
        document.body.appendChild(panel);

        const style = document.createElement('style');
        style.textContent = `
            #zoe-panel select.zoe-cat-select option,
            #zoe-panel select.zoe-tac-select option {
                background: #1a1a2e;
                color: #eee;
            }
        `;
        panel.appendChild(style);

        panel.querySelectorAll('.zoe-cat-select').forEach(sel => {
            const prevValue = sel.value;
            sel.onchange = (e) => {
                const mid = e.target.dataset.mid;
                const newCat = e.target.value;
                if (confirm(`Alterar categoria para "${newCat}"?`)) {
                    setMatchCategory(mid, newCat);
                    const catColors = { Senior: '#4caf50', U23: '#2196f3', U21: '#ff9800', U18: '#e91e63', Outros: '#9e9e9e', Desconhecido: '#ff5722' };
                    const span = document.createElement('span');
                    span.style.cssText = `color:${catColors[newCat] || '#fff'};font-weight:bold`;
                    span.textContent = newCat;
                    e.target.replaceWith(span);
                } else {
                    e.target.value = prevValue;
                }
            };
        });

        panel.querySelectorAll('.zoe-tac-select').forEach(sel => {
            const prevValue = sel.value;
            sel.onchange = (e) => {
                const mid = e.target.dataset.mid;
                const newTac = e.target.value;
                if (confirm(`Alterar tática para "${newTac}"?`)) {
                    setMatchTactic(mid, newTac);
                    const span = document.createElement('span');
                    span.style.cssText = 'color:#fff';
                    span.textContent = newTac;
                    e.target.replaceWith(span);
                } else {
                    e.target.value = prevValue;
                }
            };
        });

        Object.keys(panelFilters).forEach(k => {
            const el = panel.querySelector(`#zoe-f-${k === 'homeTeam' ? 'home' : k === 'awayTeam' ? 'away' : k === 'competition' ? 'comp' : k === 'category' ? 'cat' : k}`);
            if (el) {
                el.value = panelFilters[k];
                el.onchange = (e) => {
                    panelFilters[k] = e.target.value;
                    panel.remove();
                    showDataPanel();
                };
            }
        });

        document.getElementById('zoe-panel-close').onclick = () => panel.remove();
        const removeBtn = document.getElementById('zoe-remove-others');
        const hasEmptyTactics = visibleMatches.some(m => !(m.customTactic || m.tactic || ''));
        if (!hasEmptyTactics) removeBtn.style.display = 'none';
        removeBtn.onclick = () => {
            const result = removeNonTeamMatches();
            if (result.removed > 0) {
                alert(`Removidos ${result.removed} jogos que não pertencem à tua equipa.\n(${result.before} → ${result.after} jogos)`);
                panel.remove();
                showDataPanel();
                const all = loadMatches();
                updateBadgeUI(all);
                updateEloBtnVisibility();
                updateValueBtnVisibility();
            } else {
                alert('Não foram encontrados jogos para remover.');
            }
        };
        document.getElementById('zoe-csv-btn').onclick = () => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:1000000;display:flex;align-items:center;justify-content:center';
            overlay.innerHTML = `
                <div style="background:#1a1a2e;color:#eee;border:2px solid #e94560;border-radius:10px;padding:24px;width:300px;text-align:center;font-family:Arial,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.6)">
                    <strong style="font-size:15px;color:#e94560;display:block;margin-bottom:16px">Importar / Exportar</strong>
                    <button id="zoe-csv-import" style="background:#16213e;color:#e94560;border:1px solid #e94560;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:13px;width:100%;margin-bottom:10px">Importar CSV</button>
                    <button id="zoe-csv-export" style="background:#e94560;color:white;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:13px;width:100%;margin-bottom:10px">Exportar CSV</button>
                    <button id="zoe-csv-cancel" style="background:#333;color:#eee;border:1px solid #555;padding:8px 20px;border-radius:4px;cursor:pointer;font-size:13px;width:100%">Cancelar</button>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
            document.getElementById('zoe-csv-cancel').onclick = () => overlay.remove();
            document.getElementById('zoe-csv-import').onclick = () => { overlay.remove(); importCSV(); };
            document.getElementById('zoe-csv-export').onclick = () => { overlay.remove(); exportCSV(allMatches); };
        };
        document.getElementById('zoe-edit-mode').onchange = (e) => {
            editMode = e.target.checked;
            panel.remove();
            showDataPanel();
        };
        document.getElementById('zoe-clear-data').onclick = () => {
            const existing = loadMatches();
            if (existing.length === 0) {
                alert('Não há dados para limpar.');
                return;
            }
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:1000000;display:flex;align-items:center;justify-content:center';
            overlay.innerHTML = `
                <div style="background:#1a1a2e;color:#eee;border:2px solid #e94560;border-radius:10px;padding:24px;width:380px;text-align:center;font-family:Arial,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.6)">
                    <div style="font-size:32px;margin-bottom:8px">&#9888;</div>
                    <strong style="font-size:15px;color:#e94560">Apagar todos os dados?</strong>
                    <p style="margin:12px 0;color:#ccc;font-size:13px">Vão ser apagados <strong style="color:#fff">${existing.length} jogos</strong> guardados.<br>Esta ação não pode ser desfeita.</p>
                    <div style="display:flex;gap:10px;justify-content:center;margin-top:16px">
                        <button id="zoe-clear-confirm" style="background:#e94560;color:white;border:none;padding:8px 20px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:bold">Sim, apagar tudo</button>
                        <button id="zoe-clear-cancel" style="background:#333;color:#eee;border:1px solid #555;padding:8px 20px;border-radius:4px;cursor:pointer;font-size:13px">Cancelar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
            document.getElementById('zoe-clear-cancel').onclick = () => overlay.remove();
            document.getElementById('zoe-clear-confirm').onclick = () => {
                GM_deleteValue('zoe_matches');
                overlay.remove();
                panel.remove();
                const statusEl = document.getElementById('zoe-status');
                if (statusEl) statusEl.innerHTML = '<span style="color:#ff9800">Todos os dados foram apagados.</span>';
                updateBadgeUI([]);
                updateEloBtnVisibility();
                updateValueBtnVisibility();
            };
        };
        document.getElementById('zoe-stats-csv-btn').onclick = () => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:1000000;display:flex;align-items:center;justify-content:center';
            overlay.innerHTML = `
                <div style="background:#1a1a2e;color:#eee;border:2px solid #e94560;border-radius:10px;padding:24px;width:300px;text-align:center;font-family:Arial,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.6)">
                    <strong style="font-size:15px;color:#e94560;display:block;margin-bottom:16px">Estatísticas - Importar / Exportar</strong>
                    <button id="zoe-stats-import" style="background:#16213e;color:#e94560;border:1px solid #e94560;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:13px;width:100%;margin-bottom:10px">Importar Stats CSV</button>
                    <button id="zoe-stats-export" style="background:#e94560;color:white;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:13px;width:100%;margin-bottom:10px">Exportar Stats CSV</button>
                    <button id="zoe-stats-cancel" style="background:#333;color:#eee;border:1px solid #555;padding:8px 20px;border-radius:4px;cursor:pointer;font-size:13px;width:100%">Cancelar</button>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
            document.getElementById('zoe-stats-cancel').onclick = () => overlay.remove();
            document.getElementById('zoe-stats-import').onclick = () => { overlay.remove(); importStatsCSV(); };
            document.getElementById('zoe-stats-export').onclick = () => { overlay.remove(); exportStatsCSV(); };
        };
        document.getElementById('zoe-clear-stats').onclick = () => {
            const stats = loadStats();
            if (stats.length === 0) {
                alert('Não há estatísticas para limpar.');
                return;
            }
            const totalPlayers = stats.reduce((sum, s) => sum + s.playerStats.length, 0);
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:1000000;display:flex;align-items:center;justify-content:center';
            overlay.innerHTML = `
                <div style="background:#1a1a2e;color:#eee;border:2px solid #e94560;border-radius:10px;padding:24px;width:380px;text-align:center;font-family:Arial,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.6)">
                    <div style="font-size:32px;margin-bottom:8px">&#9888;</div>
                    <strong style="font-size:15px;color:#e94560">Apagar estatísticas?</strong>
                    <p style="margin:12px 0;color:#ccc;font-size:13px">Vão ser apagados <strong style="color:#fff">${stats.length} jogos</strong> com <strong style="color:#fff">${totalPlayers} registos</strong> de jogadores.<br>Os dados dos jogos (resultados, ELO, valores) serão mantidos.</p>
                    <div style="display:flex;gap:10px;justify-content:center;margin-top:16px">
                        <button id="zoe-clear-stats-confirm" style="background:#e94560;color:white;border:none;padding:8px 20px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:bold">Sim, apagar</button>
                        <button id="zoe-clear-stats-cancel" style="background:#333;color:#eee;border:1px solid #555;padding:8px 20px;border-radius:4px;cursor:pointer;font-size:13px">Cancelar</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
            document.getElementById('zoe-clear-stats-cancel').onclick = () => overlay.remove();
            document.getElementById('zoe-clear-stats-confirm').onclick = () => {
                GM_deleteValue('zoe_stats');
                overlay.remove();
                panel.remove();
                const statusEl = document.getElementById('zoe-status');
                if (statusEl) statusEl.innerHTML = '<span style="color:#ff9800">Estatísticas apagadas. Os dados dos jogos foram mantidos.</span>';
                updateStatsBtnVisibility();
            };
        };
        document.getElementById('zoe-show-recent').onchange = (e) => {
            showRecentResults = e.target.checked;
            panel.remove();
            showDataPanel();
            const all = loadMatches();
            updateStatusUI(all, 0);
            updateBadgeUI(all);
        };
        const clearFiltersBtn = document.getElementById('zoe-clear-filters');
        if (clearFiltersBtn) {
            clearFiltersBtn.onclick = () => {
                Object.keys(panelFilters).forEach(k => panelFilters[k] = '');
                panel.remove();
                showDataPanel();
            };
        }
        document.getElementById('zoe-tb-config').onclick = () => { showTeraboxConfigDialog(); };
    }

    function showPlayersPanel() {
        const stats = loadStats();
        if (stats.length === 0) {
            alert('Nenhuma estatística guardada ainda.\nPrimeiro extrai as estatísticas com o botão "Extrair Stats".');
            return;
        }

        const allMatches = loadMatches();
        const statsMatchIds = stats.map(s => s.matchId);
        const matchesWithStats = allMatches.filter(m => statsMatchIds.includes(m.matchId));

        const panel = document.createElement('div');
        panel.id = 'zoe-players-panel';
        panel.style.cssText = `
            position: fixed; top: 10px; right: 10px; width: 98%; max-height: 90vh;
            background: #1a1a2e; color: #eee; border: 1px solid #e94560; border-radius: 8px;
            padding: 16px; font-size: 12px; z-index: 999999; overflow-y: auto;
            font-family: Arial, sans-serif; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        `;

        let selectedMatch = '';
        let selectedSide = '';
        let selectedPosition = '';

        function getMatchOptions() {
            return matchesWithStats.map(m => {
                const label = `${m.date} | ${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam}`;
                return `<option value="${m.matchId}" ${selectedMatch === m.matchId ? 'selected' : ''}>${label}</option>`;
            }).join('');
        }

        function getAllPlayers() {
            const all = [];
            for (const matchStat of stats) {
                const match = allMatches.find(m => m.matchId === matchStat.matchId);
                for (const p of matchStat.playerStats) {
                    all.push({
                        ...p,
                        matchDate: match ? match.date : '',
                        matchHomeTeam: match ? match.homeTeam : '',
                        matchAwayTeam: match ? match.awayTeam : '',
                        matchHomeScore: match ? match.homeScore : '',
                        matchAwayScore: match ? match.awayScore : '',
                    });
                }
            }
            return all;
        }

        function filterPlayers(players) {
            return players.filter(p => {
                if (selectedMatch && p.matchId !== selectedMatch) return false;
                if (selectedSide && p.teamSide !== selectedSide) return false;
                if (selectedPosition && p.position !== selectedPosition) return false;
                return true;
            });
        }

        function getPositionCounts(players) {
            const counts = {};
            for (const p of players) {
                const pos = p.position || '?';
                counts[pos] = (counts[pos] || 0) + 1;
            }
            return counts;
        }

        function render() {
            const allPlayers = getAllPlayers();
            const filtered = filterPlayers(allPlayers);
            const posCounts = getPositionCounts(filtered);
            const positions = Object.keys(posCounts).sort();

            const selStyle = 'width:100%;font-size:10px;padding:2px 0;background:#0f3460;color:#eee;border:1px solid #333;border-radius:2px;cursor:pointer';
            const thStyle = 'padding:4px;border-bottom:1px solid #e94560;color:#fff;white-space:nowrap;cursor:pointer';
            const tdStyle = 'padding:3px;border-bottom:1px solid #333;color:#fff;text-align:center;font-size:11px';

            panel.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid #e94560;padding-bottom:8px">
                    <strong style="font-size:14px;color:#e94560">ZOE - Estatísticas dos Jogadores</strong>
                    <span style="cursor:pointer;font-size:18px" id="zoe-players-panel-close">&times;</span>
                </div>
                <div style="margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <strong>${filtered.length} jogadores</strong>
                    <select id="zoe-p-match" style="${selStyle};width:200px">
                        <option value="" ${!selectedMatch ? 'selected' : ''}>Todos os jogos</option>
                        ${getMatchOptions()}
                    </select>
                    <select id="zoe-p-side" style="${selStyle};width:120px">
                        <option value="" ${!selectedSide ? 'selected' : ''}>Todas as equipas</option>
                        <option value="home" ${selectedSide === 'home' ? 'selected' : ''}>Casa</option>
                        <option value="away" ${selectedSide === 'away' ? 'selected' : ''}>Fora</option>
                    </select>
                    <select id="zoe-p-position" style="${selStyle};width:100px">
                        <option value="" ${!selectedPosition ? 'selected' : ''}>Todas as posições</option>
                        ${positions.map(p => `<option value="${p}" ${selectedPosition === p ? 'selected' : ''}>${p} (${posCounts[p]})</option>`).join('')}
                    </select>
                    <button id="zoe-players-csv-btn" style="background:#16213e;color:#e94560;border:1px solid #e94560;padding:2px 8px;border-radius:4px;cursor:pointer">Exportar CSV</button>
                </div>
                <div style="overflow-x:auto">
                <table style="width:100%;border-collapse:collapse;color:#fff;font-size:11px">
                    <thead>
                        <tr style="background:#16213e">
                            <th style="${thStyle}text-align:left">Jogador</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Posição">Po</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Minutos Disputados">MD</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Golos">G</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Assistências">A</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Remates">Rem</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Percentagem de todos os remates que resultaram em golo">Rem%</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Remates à baliza">RB</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Percentagem de remates enquadrados">RemEnq%</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Auto-golo">AG</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Passes">Pas</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Passes bem Sucedidos">PbS</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Passes não enquadrados">PmS</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Percentagem de passes bem-sucedidos">PbS%</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="A distância média de passes bem sucedidos (m)">PbS</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Intercepções">In</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Desarmes">Des</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Desarmes bem Sucedidos">DbS</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Desarmes Falhados">DF</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Percentagem de desarmes bem sucedidos">DbS%</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Posse de bola em minutos">PB</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Percentagem de posse de bola quando comparada com a posse de toda a equipa">PB%</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Distância total de movimento (km)">Dist</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Distância total de movimento com a posse de bola (km)">Dist.P</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="A velocidade média do jogador com a posse de bola (km/h)">Vel.PB</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="A velocidade média do jogador durante a corrida (km/h)">Vel.Jog</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Cantos Obtidos">Cnt</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Livres Cobrados">LC</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Penáltis obtidos">P</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Cartões Amarelos">CA</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Cartões Vermelhos">CV</th>
                            <th style="${thStyle}text-align:center;position:relative" data-tooltip="Defesas">DF</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filtered.map(p => {
                            const sideColor = p.teamSide === 'home' ? '#4caf50' : '#2196f3';
                            return `<tr>
                                <td style="${tdStyle};text-align:left;white-space:nowrap" title="${p.matchDate} | ${p.matchHomeTeam} vs ${p.matchAwayTeam} (${p.matchHomeScore}-${p.matchAwayScore})">
                                    <span style="color:${sideColor}">${p.shirtNumber || '-'}</span>
                                    <a href="https://www.managerzone.com/?p=players&sub=view&pid=${p.playerID}" target="_blank" style="color:#fff;text-decoration:none;border-bottom:1px dashed #e94560">${p.playerName}</a>
                                </td>
                                <td style="${tdStyle}">${p.position}</td>
                                <td style="${tdStyle}">${p.minutes}</td>
                                <td style="${tdStyle};font-weight:bold;color:${parseInt(p.goals) > 0 ? '#4caf50' : '#888'}">${p.goals}</td>
                                <td style="${tdStyle};color:${parseInt(p.assists) > 0 ? '#4caf50' : '#888'}">${p.assists}</td>
                                <td style="${tdStyle}">${p.shots}</td>
                                <td style="${tdStyle}">${p.shotPct}</td>
                                <td style="${tdStyle}">${p.shotsOnTarget}</td>
                                <td style="${tdStyle}">${p.shotAccuracyPct}</td>
                                <td style="${tdStyle};color:${parseInt(p.autoGoals) > 0 ? '#f44336' : '#888'}">${p.autoGoals}</td>
                                <td style="${tdStyle}">${p.passes}</td>
                                <td style="${tdStyle}">${p.successfulPasses}</td>
                                <td style="${tdStyle}">${p.failedPasses}</td>
                                <td style="${tdStyle}">${p.passAccuracyPct}</td>
                                <td style="${tdStyle}">${p.avgPassDist}</td>
                                <td style="${tdStyle}">${p.interceptions}</td>
                                <td style="${tdStyle}">${p.tackles}</td>
                                <td style="${tdStyle}">${p.successfulTackles}</td>
                                <td style="${tdStyle}">${p.failedTackles}</td>
                                <td style="${tdStyle}">${p.tacklePct}</td>
                                <td style="${tdStyle}">${p.possessionMin}</td>
                                <td style="${tdStyle}">${p.possessionPct}</td>
                                <td style="${tdStyle}">${p.distance}</td>
                                <td style="${tdStyle}">${p.distanceWithBall}</td>
                                <td style="${tdStyle}">${p.speedWithBall}</td>
                                <td style="${tdStyle}">${p.runningSpeed}</td>
                                <td style="${tdStyle}">${p.corners}</td>
                                <td style="${tdStyle}">${p.freeKicks}</td>
                                <td style="${tdStyle}">${p.penaltiesWon}</td>
                                <td style="${tdStyle};color:${parseInt(p.yellowCards) > 0 ? '#ffeb3b' : '#888'}">${p.yellowCards}</td>
                                <td style="${tdStyle};color:${parseInt(p.redCards) > 0 ? '#f44336' : '#888'}">${p.redCards}</td>
                                <td style="${tdStyle}">${p.saves}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
                </div>
            `;

            document.body.appendChild(panel);

            const oldTooltip = document.getElementById('zoe-tooltip');
            if (oldTooltip) oldTooltip.remove();

            let tooltipEl = null;
            function showTooltip(e) {
                const text = e.target.getAttribute('data-tooltip');
                if (!text) return;
                if (!tooltipEl) {
                    tooltipEl = document.createElement('div');
                    tooltipEl.id = 'zoe-tooltip';
                    tooltipEl.style.cssText = 'position:fixed;background:#000;color:#fff;padding:4px 8px;border-radius:4px;font-size:11px;white-space:nowrap;pointer-events:none;z-index:1000001;font-family:Arial,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.4)';
                    document.body.appendChild(tooltipEl);
                }
                tooltipEl.textContent = text;
                tooltipEl.style.display = 'block';
                const rect = e.target.getBoundingClientRect();
                tooltipEl.style.left = rect.left + rect.width / 2 - tooltipEl.offsetWidth / 2 + 'px';
                tooltipEl.style.top = rect.top - tooltipEl.offsetHeight - 4 + 'px';
            }
            function hideTooltip() {
                if (tooltipEl) tooltipEl.style.display = 'none';
            }
            panel.querySelectorAll('th[data-tooltip]').forEach(th => {
                th.addEventListener('mouseenter', showTooltip);
                th.addEventListener('mouseleave', hideTooltip);
            });

            document.getElementById('zoe-players-panel-close').onclick = () => { if (tooltipEl) tooltipEl.remove(); panel.remove(); };
            document.getElementById('zoe-p-match').onchange = (e) => { selectedMatch = e.target.value; panel.remove(); render(); };
            document.getElementById('zoe-p-side').onchange = (e) => { selectedSide = e.target.value; panel.remove(); render(); };
            document.getElementById('zoe-p-position').onchange = (e) => { selectedPosition = e.target.value; panel.remove(); render(); };
            document.getElementById('zoe-players-csv-btn').onclick = () => { exportStatsCSV(); };
        }

        render();
    }

    function exportCSV(matches) {
        const header = 'Data,Hora,Época,Tipo,Nome da Competição,Categoria,ELOCasa,Casa,ValorCasa,Fora,ValorFora,ELOFora,Resultado,NossoScore,AdversarioScore,MatchID,Tática\n';
        const rows = matches.map(m => {
            const category = getMatchCategory(m);
            const season = m.season || getSeason(m.date);
            return `"${m.date}","${m.time}","${season}","${m.type}","${m.competition}","${category}","${m.homeElo}","${m.homeTeam}","${m.homeValue || ''}","${m.awayTeam}","${m.awayValue || ''}","${m.awayElo}","${m.result}","${m.ourScore}","${m.theirScore}","${m.matchId}","${m.tactic}"`;
        }).join('\n');
        const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `zoe_matches_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function exportStatsCSV() {
        const stats = loadStats();
        if (stats.length === 0) {
            alert('Não há estatísticas para exportar.');
            return;
        }

        const header = STATS_COLUMNS.join(',') + '\n';
        const rows = [];
        for (const match of stats) {
            for (const p of match.playerStats) {
                const row = [
                    p.matchId, p.teamSide, p.playerID, p.shirtNumber, `"${p.playerName}"`, p.position, p.minutes,
                    p.goals, p.assists, p.shots, p.shotPct, p.shotsOnTarget, p.shotAccuracyPct, p.autoGoals,
                    p.passes, p.successfulPasses, p.failedPasses, p.passAccuracyPct, p.avgPassDist,
                    p.interceptions, p.tackles, p.successfulTackles, p.failedTackles, p.tacklePct,
                    p.possessionMin, p.possessionPct, p.distance, p.distanceWithBall, p.speedWithBall, p.runningSpeed,
                    p.corners, p.freeKicks, p.penaltiesWon, p.yellowCards, p.redCards, p.saves
                ];
                rows.push(row.join(','));
            }
        }

        const blob = new Blob(['\uFEFF' + header + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `stats_players_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    // --- TeraBox Backup Module ---
    const TERABOX_UPLOAD_HOST = 'https://c-all.terabox.com';

    function isTeraboxConfigured() {
        const c = getTeraboxConfig();
        return !!(c && c.ndus);
    }

    function buildTeraboxCookie(config) {
        const p = ['lang=en'];
        if (config.ndus) p.push('ndus=' + config.ndus);
        if (config.csrfToken) p.push('csrfToken=' + config.csrfToken);
        if (config.browserid) p.push('browserid=' + config.browserid);
        if (config.ndut_fmt) p.push('ndut_fmt=' + config.ndut_fmt);
        return p.join('; ');
    }

    function fetchTeraboxTokens(config) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: TERABOX_BASE + '/main',
                headers: {
                    'Cookie': buildTeraboxCookie(config),
                    'Accept': 'text/html',
                    'User-Agent': navigator.userAgent,
                    'Referer': TERABOX_BASE
                },
                onload: (resp) => {
                    const html = resp.responseText;
                    const newConfig = Object.assign({}, config);
                    let found = false;
                    const jtMatch = html.match(/fn\(\x22([^\x29]+)\x22\)/);
                    if (jtMatch && jtMatch[1]) {
                        newConfig.jsToken = jtMatch[1];
                        found = true;
                        console.log('ZOE TB: jsToken obtido automaticamente');
                    }
                    const btMatch = html.match(/"bdstoken"\s*:\s*"([^"]+)"/);
                    if (btMatch && btMatch[1]) {
                        newConfig.bdstoken = btMatch[1];
                        found = true;
                        console.log('ZOE TB: bdstoken obtido automaticamente');
                    }
                    if (found) resolve(newConfig);
                    else reject(new Error('Tokens não encontrados na página TeraBox'));
                },
                onerror: () => reject(new Error('Erro de rede ao buscar tokens TeraBox')),
                ontimeout: () => reject(new Error('Timeout ao buscar tokens TeraBox'))
            });
        });
    }

    function generateDpLogId() {
        let s = '';
        for (let i = 0; i < 20; i++) s += Math.floor(Math.random() * 16).toString(16);
        return s;
    }

    function md5(str) {
        function L(k, d) { return (k << d) | (k >>> (32 - d)); }
        function K(G, k) { var I, d, F, x, H; F = (G & 2147483648); x = (k & 2147483648); I = (G & 1073741824); d = (k & 1073741824); H = (G & 1073741823) + (k & 1073741823); if (I & d) return (H ^ 2147483648 ^ F ^ x); if (I | d) { if (H & 1073741824) return (H ^ 3221225472 ^ F ^ x); else return (H ^ 1073741824 ^ F ^ x); } else return (H ^ F ^ x); }
        function r(d, F, k) { return (d & F) | ((~d) & k); }
        function q(d, F, k) { return (d & k) | (F & (~k)); }
        function p(d, F, k) { return (d ^ F ^ k); }
        function n(d, F, k) { return (F ^ (d | (~k))); }
        function u(G, F, aa, Z, k, H, I) { G = K(G, K(K(r(F, aa, Z), k), I)); return K(L(G, H), F); }
        function f(G, F, aa, Z, k, H, I) { G = K(G, K(K(q(F, aa, Z), k), I)); return K(L(G, H), F); }
        function D(G, F, aa, Z, k, H, I) { G = K(G, K(K(p(F, aa, Z), k), I)); return K(L(G, H), F); }
        function t(G, F, aa, Z, k, H, I) { G = K(G, K(K(n(F, aa, Z), k), I)); return K(L(G, H), F); }
        function e(G) { var Z; var F = G.length; var x = F + 8; var k = (x - (x % 64)) / 64; var I = (k + 1) * 16; var aa = Array(I - 1); var d = 0; var H = 0; while (H < F) { Z = (H - (H % 4)) / 4; d = (H % 4) * 8; aa[Z] = (aa[Z] | (G.charCodeAt(H) << d)); H++; } Z = (H - (H % 4)) / 4; d = (H % 4) * 8; aa[Z] = aa[Z] | (128 << d); aa[I - 2] = F << 3; aa[I - 1] = F >>> 29; return aa; }
        function B(x) { var k = "", F = "", G, d; for (d = 0; d <= 3; d++) { G = (x >>> (d * 8)) & 255; F = "0" + G.toString(16); k = k + F.substr(F.length - 2, 2); } return k; }
        var C = []; var P, h, E, v, g, Y, X, W, V;
        var S = 7, Q = 12, N = 17, M = 22;
        var A = 5, z = 9, y = 14, w = 20;
        var o = 4, m = 11, l = 16, j = 23;
        var U = 6, T = 10, R = 15, O = 21;
        str = decodeURIComponent(encodeURIComponent(str));
        C = e(str); Y = 1732584193; X = 4023233417; W = 2562383102; V = 271733878;
        for (P = 0; P < C.length; P += 16) {
            h = Y; E = X; v = W; g = V;
            Y = u(Y, X, W, V, C[P+0], S, 3614090360); V = u(V, Y, X, W, C[P+1], Q, 3905402710); W = u(W, V, Y, X, C[P+2], N, 606105819); X = u(X, W, V, Y, C[P+3], M, 3250441966);
            Y = u(Y, X, W, V, C[P+4], S, 4118548399); V = u(V, Y, X, W, C[P+5], Q, 1200080426); W = u(W, V, Y, X, C[P+6], N, 2821735955); X = u(X, W, V, Y, C[P+7], M, 4249261313);
            Y = u(Y, X, W, V, C[P+8], S, 1770035416); V = u(V, Y, X, W, C[P+9], Q, 2336552879); W = u(W, V, Y, X, C[P+10], N, 4294925233); X = u(X, W, V, Y, C[P+11], M, 2304563134);
            Y = u(Y, X, W, V, C[P+12], S, 1804603682); V = u(V, Y, X, W, C[P+13], Q, 4254626195); W = u(W, V, Y, X, C[P+14], N, 2792965006); X = u(X, W, V, Y, C[P+15], M, 1236535329);
            Y = f(Y, X, W, V, C[P+1], A, 4129170786); V = f(V, Y, X, W, C[P+6], z, 3225465664); W = f(W, V, Y, X, C[P+11], y, 643717713); X = f(X, W, V, Y, C[P+0], w, 3921069994);
            Y = f(Y, X, W, V, C[P+5], A, 3593408605); V = f(V, Y, X, W, C[P+10], z, 38016083); W = f(W, V, Y, X, C[P+15], y, 3634488961); X = f(X, W, V, Y, C[P+4], w, 3889429448);
            Y = f(Y, X, W, V, C[P+9], A, 568446438); V = f(V, Y, X, W, C[P+14], z, 3275163606); W = f(W, V, Y, X, C[P+3], y, 4107603335); X = f(X, W, V, Y, C[P+8], w, 1163531501);
            Y = f(Y, X, W, V, C[P+13], A, 2850285829); V = f(V, Y, X, W, C[P+2], z, 4243563512); W = f(W, V, Y, X, C[P+7], y, 1735328473); X = f(X, W, V, Y, C[P+12], w, 2368359562);
            Y = D(Y, X, W, V, C[P+5], o, 4294588738); V = D(V, Y, X, W, C[P+8], m, 2272392833); W = D(W, V, Y, X, C[P+11], l, 1839030562); X = D(X, W, V, Y, C[P+14], j, 4259657740);
            Y = D(Y, X, W, V, C[P+1], o, 2763975236); V = D(V, Y, X, W, C[P+4], m, 1272893353); W = D(W, V, Y, X, C[P+7], l, 4139469664); X = D(X, W, V, Y, C[P+10], j, 3200236656);
            Y = D(Y, X, W, V, C[P+13], o, 681279174); V = D(V, Y, X, W, C[P+0], m, 3936430074); W = D(W, V, Y, X, C[P+3], l, 3572445317); X = D(X, W, V, Y, C[P+6], j, 76029189);
            Y = D(Y, X, W, V, C[P+9], o, 3654602809); V = D(V, Y, X, W, C[P+12], m, 3873151461); W = D(W, V, Y, X, C[P+15], l, 530742520); X = D(X, W, V, Y, C[P+2], j, 3299628645);
            Y = t(Y, X, W, V, C[P+0], U, 4096336452); V = t(V, Y, X, W, C[P+7], T, 1126891415); W = t(W, V, Y, X, C[P+14], R, 2878612391); X = t(X, W, V, Y, C[P+5], O, 4237533241);
            Y = t(Y, X, W, V, C[P+12], U, 1700485571); V = t(V, Y, X, W, C[P+3], T, 2399980690); W = t(W, V, Y, X, C[P+10], R, 4293915773); X = t(X, W, V, Y, C[P+1], O, 2240044497);
            Y = t(Y, X, W, V, C[P+8], U, 1873313359); V = t(V, Y, X, W, C[P+15], T, 4264355552); W = t(W, V, Y, X, C[P+6], R, 2734768916); X = t(X, W, V, Y, C[P+13], O, 1309151649);
            Y = t(Y, X, W, V, C[P+4], U, 4149444226); V = t(V, Y, X, W, C[P+11], T, 3174756917); W = t(W, V, Y, X, C[P+2], R, 718787259); X = t(X, W, V, Y, C[P+9], O, 3951481745);
            Y = K(Y, h); X = K(X, E); W = K(W, v); V = K(V, g);
        }
        return (B(Y) + B(X) + B(W) + B(V)).toLowerCase();
    }

    function teraboxRequestWithRetry(method, url, config, body, contentType, retryCount) {
        retryCount = retryCount || 0;
        return new Promise((resolve, reject) => {
            const opts = {
                method: method,
                url: url,
                headers: {
                    'Cookie': buildTeraboxCookie(config),
                    'Origin': TERABOX_BASE,
                    'Referer': TERABOX_BASE + '/main'
                },
                onload: (resp) => {
                    try {
                        const data = JSON.parse(resp.responseText);
                        if (data.errno === 4000023 && retryCount < 1) {
                            console.log('ZOE TB: token expirado, a renovar...');
                            fetchTeraboxTokens(config).then((freshConfig) => {
                                saveTeraboxConfig(freshConfig);
                                resolve(teraboxRequestWithRetry(method, url, freshConfig, body, contentType, retryCount + 1));
                            }).catch(reject);
                        } else { resolve(data); }
                    } catch(e) { reject(new Error('Resposta inválida do TeraBox: ' + resp.responseText.substring(0, 200))); }
                },
                onerror: (err) => reject(new Error('Erro de rede: ' + (err.statusText || 'desconhecido'))),
                ontimeout: () => reject(new Error('Timeout ao contactar TeraBox'))
            };
            if (body && contentType) {
                opts.headers['Content-Type'] = contentType;
                opts.data = body;
            }
            GM_xmlhttpRequest(opts);
        });
    }

    function teraboxRequest(method, url, config, body, contentType) {
        return new Promise((resolve, reject) => {
            const opts = {
                method: method,
                url: url,
                headers: {
                    'Cookie': buildTeraboxCookie(config),
                    'Origin': 'https://www.terabox.com',
                    'Referer': 'https://www.terabox.com/main'
                },
                onload: (resp) => {
                    try { resolve(JSON.parse(resp.responseText)); }
                    catch(e) { reject(new Error('Resposta inválida do TeraBox: ' + resp.responseText.substring(0, 200))); }
                },
                onerror: (err) => reject(new Error('Erro de rede: ' + (err.statusText || 'desconhecido'))),
                ontimeout: () => reject(new Error('Timeout ao contactar TeraBox'))
            };
            if (body && contentType) {
                opts.headers['Content-Type'] = contentType;
                opts.data = body;
            }
            GM_xmlhttpRequest(opts);
        });
    }

    async function teraboxCreateDir(config, dirPath) {
        const params = new URLSearchParams({
            path: dirPath, isdir: '1', size: '0', block_list: '[]',
            local_mtime: String(Math.floor(Date.now() / 1000)),
            app_id: TERABOX_APP_ID, jsToken: config.jsToken,
            'dp-logid': generateDpLogId()
        });
        return teraboxRequestWithRetry('POST', TERABOX_BASE + '/api/create', config, params.toString(), 'application/x-www-form-urlencoded');
    }

    async function teraboxPrecreate(config, remotePath, fileSize, blockList) {
        const params = new URLSearchParams({
            path: remotePath, autoinit: '1', target_path: remotePath.substring(0, remotePath.lastIndexOf('/')),
            block_list: JSON.stringify(blockList), size: String(fileSize),
            local_mtime: String(Math.floor(Date.now() / 1000)),
            app_id: TERABOX_APP_ID, web: '1', channel: 'dubox', clienttype: '0',
            jsToken: config.jsToken, 'dp-logid': generateDpLogId()
        });
        if (config.bdstoken) params.set('bdstoken', config.bdstoken);
        return teraboxRequestWithRetry('POST', TERABOX_BASE + '/api/precreate', config, params.toString(), 'application/x-www-form-urlencoded');
    }

    async function teraboxUploadChunk(config, remotePath, uploadId, fileData, partseq, uploadHost) {
        const boundary = '----ZOE' + Math.random().toString(36).slice(2);
        const filename = remotePath.split('/').pop();
        const body = '--' + boundary + '\r\n' +
            'Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n' +
            'Content-Type: text/csv; charset=utf-8\r\n\r\n' +
            fileData + '\r\n' +
            '--' + boundary + '--\r\n';
        const host = uploadHost || TERABOX_UPLOAD_HOST;
        const url = host + '/rest/2.0/pcs/superfile2?method=upload&app_id=' + TERABOX_APP_ID +
            '&channel=dubox&clienttype=0&web=1&path=' + encodeURIComponent(remotePath) +
            '&uploadid=' + uploadId + '&uploadsign=0&partseq=' + partseq +
            '&jsToken=' + encodeURIComponent(config.jsToken);
        return teraboxRequestWithRetry('POST', url, config, body, 'multipart/form-data; boundary=' + boundary);
    }

    async function teraboxCreate(config, remotePath, fileSize, uploadId, blockList) {
        const params = new URLSearchParams({
            path: remotePath, size: String(fileSize), uploadid: uploadId,
            target_path: remotePath.substring(0, remotePath.lastIndexOf('/')) + '/',
            block_list: JSON.stringify(blockList),
            local_mtime: String(Math.floor(Date.now() / 1000)),
            isdir: '0', rtype: '1',
            app_id: TERABOX_APP_ID, jsToken: config.jsToken,
            'dp-logid': generateDpLogId()
        });
        if (config.bdstoken) params.set('bdstoken', config.bdstoken);
        return teraboxRequestWithRetry('POST', TERABOX_BASE + '/api/create', config, params.toString(), 'application/x-www-form-urlencoded');
    }

    async function uploadToTerabox(config, fileData, remotePath) {
        const fileHash = md5(fileData);
        const fileSize = new Blob([fileData]).size;
        console.log('ZOE TB: upload start', remotePath, 'size=' + fileSize, 'hash=' + fileHash);
        const pre = await teraboxPrecreate(config, remotePath, fileSize, [fileHash]);
        console.log('ZOE TB: precreate result:', JSON.stringify(pre).substring(0, 300));
        if (pre.errno !== 0) throw new Error('Erro no precreate: ' + (pre.errmsg || pre.errno));
        const uploadId = pre.uploadid;
        const uploadHost = pre.upload_host || pre.host || TERABOX_UPLOAD_HOST;
        console.log('ZOE TB: using upload host:', uploadHost);
        const upResp = await teraboxUploadChunk(config, remotePath, uploadId, fileData, 0, uploadHost);
        console.log('ZOE TB: upload result:', JSON.stringify(upResp).substring(0, 300));
        if (!upResp.md5) throw new Error('Erro no upload: resposta sem md5');
        const serverMd5 = upResp.md5;
        const cr = await teraboxCreate(config, remotePath, fileSize, uploadId, [serverMd5]);
        console.log('ZOE TB: create result:', JSON.stringify(cr).substring(0, 300));
        if (cr.errno !== 0) throw new Error('Erro no create: ' + (cr.errmsg || cr.errno));
        return cr;
    }

    // --- Script Code Backup (GitHub) ---
    const TERABOX_SCRIPT_BACKUP_KEY = 'zoe_last_script_backup_lines';
    const TERABOX_SCRIPT_LAST_HASH_KEY = 'zoe_last_script_hash';

    function fetchScriptFromGitHub(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                headers: { 'Accept': 'text/plain' },
                onload: (resp) => {
                    if (resp.status === 200 && resp.responseText) {
                        resolve(resp.responseText);
                    } else {
                        reject(new Error('HTTP ' + resp.status));
                    }
                },
                onerror: () => reject(new Error('Erro de rede ao buscar script do GitHub')),
                ontimeout: () => reject(new Error('Timeout ao buscar script do GitHub'))
            });
        });
    }

    function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const chr = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0;
        }
        return hash.toString(36);
    }

    async function backupScriptFromGitHub() {
        const config = getTeraboxConfig();
        if (!config || !config.githubRawUrl) return null;
        try {
            const code = await fetchScriptFromGitHub(config.githubRawUrl);
            const lineCount = code.split('\n').length;
            const codeHash = simpleHash(code);
            const lastHash = GM_getValue(TERABOX_SCRIPT_LAST_HASH_KEY, '');
            if (codeHash === lastHash) return null;
            const filename = 'zoe.user.js';
            const path = TERABOX_FOLDER + '/' + filename;
            await uploadToTerabox(config, code, path);
            GM_setValue(TERABOX_SCRIPT_LAST_HASH_KEY, codeHash);
            GM_setValue(TERABOX_SCRIPT_BACKUP_KEY, lineCount);
            console.log('ZOE: Script backup enviado (' + lineCount + ' linhas, hash: ' + codeHash + ')');
            return { filename: filename, lineCount: lineCount };
        } catch(e) {
            console.error('ZOE: Erro no script backup:', e.message);
            throw e;
        }
    }

    function generateMatchesCSVString(matches) {
        const header = 'Data,Hora,Época,Tipo,Nome da Competição,Categoria,ELOCasa,Casa,ValorCasa,Fora,ValorFora,ELOFora,Resultado,NossoScore,AdversarioScore,MatchID,Tática\n';
        const rows = matches.map(m => {
            const category = getMatchCategory(m);
            const season = m.season || getSeason(m.date);
            return '"' + m.date + '","' + m.time + '","' + season + '","' + m.type + '","' + (m.competition || '') + '","' + category + '","' + (m.homeElo || '') + '","' + m.homeTeam + '","' + (m.homeValue || '') + '","' + m.awayTeam + '","' + (m.awayValue || '') + '","' + (m.awayElo || '') + '","' + m.result + '","' + (m.ourScore || '') + '","' + (m.theirScore || '') + '","' + m.matchId + '","' + (m.tactic || '') + '"';
        }).join('\n');
        return header + rows;
    }

    function generateStatsCSVString() {
        const stats = loadStats();
        if (stats.length === 0) return '';
        const header = STATS_COLUMNS.join(',') + '\n';
        const rows = [];
        for (const match of stats) {
            for (const p of match.playerStats) {
                rows.push([
                    p.matchId, p.teamSide, p.playerID, p.shirtNumber, '"' + (p.playerName || '') + '"', p.position, p.minutes,
                    p.goals, p.assists, p.shots, p.shotPct, p.shotsOnTarget, p.shotAccuracyPct, p.autoGoals,
                    p.passes, p.successfulPasses, p.failedPasses, p.passAccuracyPct, p.avgPassDist,
                    p.interceptions, p.tackles, p.successfulTackles, p.failedTackles, p.tacklePct,
                    p.possessionMin, p.possessionPct, p.distance, p.distanceWithBall, p.speedWithBall, p.runningSpeed,
                    p.corners, p.freeKicks, p.penaltiesWon, p.yellowCards, p.redCards, p.saves
                ].join(','));
            }
        }
        return header + rows.join('\n');
    }

    async function backupToTerabox() {
        let config = getTeraboxConfig();
        if (!config) throw new Error('TeraBox não configurado');
        try {
            config = await fetchTeraboxTokens(config);
            saveTeraboxConfig(config);
        } catch(e) {
            console.warn('ZOE TB: não foi possível obter tokens frescos:', e.message);
            if (!config.jsToken) throw new Error('Sem jsToken — faz login no TeraBox primeiro');
        }
        const today = new Date().toISOString().slice(0, 10);
        let uploaded = 0;
        let errors = [];
        const matches = loadMatches();
        if (matches.length > 0) {
            try {
                const csv = generateMatchesCSVString(matches);
                const path = TERABOX_FOLDER + '/zoe_matches_' + today + '.csv';
                await uploadToTerabox(config, csv, path);
                uploaded++;
            } catch(e) { errors.push('Matches: ' + e.message); }
        }
        const stats = loadStats();
        if (stats.length > 0) {
            try {
                const csv = generateStatsCSVString();
                if (csv) {
                    const path = TERABOX_FOLDER + '/stats_players_' + today + '.csv';
                    await uploadToTerabox(config, csv, path);
                    uploaded++;
                }
            } catch(e) { errors.push('Stats: ' + e.message); }
        }
        GM_setValue(TERABOX_LAST_BACKUP_KEY, Date.now());
        return { uploaded, errors };
    }

    async function checkAutoBackup() {
        if (!isTeraboxConfigured()) return;
        const lastBackup = GM_getValue(TERABOX_LAST_BACKUP_KEY, 0);
        const now = new Date();
        const lastDate = new Date(lastBackup);
        const alreadyBackedUpToday = lastBackup > 0 && now.toDateString() === lastDate.toDateString();
        if (!alreadyBackedUpToday) {
            const matches = loadMatches();
            if (matches.length > 0) {
                try {
                    const result = await backupToTerabox();
                    if (result.errors.length === 0) {
                        console.log('ZOE: Backup automático TeraBox concluído (' + result.uploaded + ' ficheiros)');
                    } else {
                        console.warn('ZOE: Backup TeraBox com erros:', result.errors);
                    }
                } catch(e) {
                    console.error('ZOE: Erro no backup automático TeraBox:', e.message);
                }
            }
        }
        const config = getTeraboxConfig();
        if (config && config.githubRawUrl) {
            try {
                const scriptResult = await backupScriptFromGitHub();
                if (scriptResult) {
                    console.log('ZOE: Script backup concluído (' + scriptResult.lineCount + ' linhas)');
                }
            } catch(e) {
                console.error('ZOE: Erro no script backup:', e.message);
            }
        }
    }

    function showTeraboxConfigDialog() {
        const existing = getTeraboxConfig() || {};
        const isConnected = !!(existing.ndus);
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:1000000;display:flex;align-items:center;justify-content:center';
        overlay.innerHTML = `
            <div style="background:#1a1a2e;color:#eee;border:2px solid #e94560;border-radius:10px;padding:20px;width:420px;font-family:Arial,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.6)">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid #e94560;padding-bottom:8px">
                    <strong style="font-size:14px;color:#e94560">Configurar TeraBox</strong>
                    <span style="cursor:pointer;font-size:18px" id="zoe-tb-close">&times;</span>
                </div>
                ${isConnected
                    ? '<p style="font-size:12px;color:#4caf50;margin:0 0 10px">Ligado ao TeraBox! Cookies capturados automaticamente.</p>'
                    : '<p style="font-size:12px;color:#aaa;margin:0 0 10px">Clica no botão abaixo para ligar ao TeraBox. Os cookies serão capturados automaticamente.</p>'
                }
                <button id="zoe-tb-connect" style="width:100%;background:${isConnected ? '#333' : '#4caf50'};color:white;border:none;padding:12px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:bold">${isConnected ? 'Voltar a ligar ao TeraBox' : 'Ligar ao TeraBox'}</button>
                <div style="display:flex;gap:8px;margin-top:12px">
                    ${isConnected ? '<button id="zoe-tb-disconnect" style="flex:1;background:#f44336;color:white;border:none;padding:8px;border-radius:4px;cursor:pointer;font-size:12px">Desligar</button>' : ''}
                    <button id="zoe-tb-test" style="flex:1;background:#16213e;color:#e94560;border:1px solid #e94560;padding:8px;border-radius:4px;cursor:pointer;font-size:12px">Testar Conexão</button>
                    <button id="zoe-tb-cancel" style="background:#333;color:#eee;border:1px solid #555;padding:8px 12px;border-radius:4px;cursor:pointer;font-size:12px">Fechar</button>
                </div>
                <div style="margin-top:12px;border-top:1px solid #333;padding-top:10px">
                    <label style="font-size:11px;color:#e94560;font-weight:bold">Backup automático do código (GitHub):</label>
                    <div style="display:flex;gap:4px;margin-top:4px">
                        <input id="zoe-tb-gh-url" value="${existing.githubRawUrl || ''}" placeholder="https://raw.githubusercontent.com/user/repo/main/zoe.user.js" style="flex:1;background:#0f3460;color:#eee;border:1px solid #333;padding:6px;border-radius:3px;font-size:11px;box-sizing:border-box">
                        <button id="zoe-tb-gh-save" style="background:#4caf50;color:white;border:none;padding:6px 10px;border-radius:3px;cursor:pointer;font-size:11px">Guardar</button>
                    </div>
                    <p style="font-size:9px;color:#666;margin:4px 0 0">URL raw do ficheiro no GitHub. O script verifica diariamente se houve alterações.</p>
                </div>
                <div id="zoe-tb-status" style="margin-top:8px;font-size:11px;min-height:16px"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        document.getElementById('zoe-tb-close').onclick = () => overlay.remove();
        document.getElementById('zoe-tb-cancel').onclick = () => overlay.remove();
        document.getElementById('zoe-tb-connect').onclick = () => {
            window.open('https://www.terabox.com/main', '_blank');
            document.getElementById('zoe-tb-status').innerHTML = '<span style="color:#ff9800">Abriu TeraBox. Faz login e espera 5 segundos.</span>';
            setTimeout(() => {
                const config = getTeraboxConfig();
                if (config && config.ndus) {
                    document.getElementById('zoe-tb-status').innerHTML = '<span style="color:#4caf50">Cookies capturados com sucesso!</span>';
                    setTimeout(() => overlay.remove(), 1000);
                } else {
                    document.getElementById('zoe-tb-status').innerHTML = '<span style="color:#f44336">Não capturou. Certifica-te que fizeste login no TeraBox e que o script está ativo nesse site.</span>';
                }
            }, 6000);
        };
        const disconnectBtn = document.getElementById('zoe-tb-disconnect');
        if (disconnectBtn) {
            disconnectBtn.onclick = () => {
                GM_deleteValue(TERABOX_CONFIG_KEY);
                document.getElementById('zoe-tb-status').innerHTML = '<span style="color:#f44336">Desligado do TeraBox.</span>';
                setTimeout(() => overlay.remove(), 1000);
            };
        }
        document.getElementById('zoe-tb-gh-save').onclick = () => {
            const url = document.getElementById('zoe-tb-gh-url').value.trim();
            const config = getTeraboxConfig() || {};
            config.githubRawUrl = url;
            saveTeraboxConfig(config);
            const statusEl = document.getElementById('zoe-tb-status');
            if (url) {
                statusEl.innerHTML = '<span style="color:#4caf50">URL do GitHub guardada!</span>';
            } else {
                statusEl.innerHTML = '<span style="color:#ff9800">URL removida. Backup do código desativado.</span>';
            }
        };
        document.getElementById('zoe-tb-test').onclick = async () => {
            const statusEl = document.getElementById('zoe-tb-status');
            const config = getTeraboxConfig();
            if (!config || !config.ndus) {
                statusEl.innerHTML = '<span style="color:#f44336">Não está ligado ao TeraBox. Clica em "Ligar ao TeraBox" primeiro.</span>';
                return;
            }
            statusEl.innerHTML = '<span style="color:#ff9800">A testar...</span>';
            try {
                const freshConfig = await fetchTeraboxTokens(config);
                saveTeraboxConfig(freshConfig);
                const result = await teraboxRequestWithRetry('GET',
                    TERABOX_BASE + '/api/list?app_id=' + TERABOX_APP_ID + '&web=1&channel=dubox&clienttype=0&jsToken=' + freshConfig.jsToken + '&dir=/&num=10&page=1',
                    freshConfig);
                if (result.errno === 0) {
                    statusEl.innerHTML = '<span style="color:#4caf50">Conexão OK! (' + (result.list || []).length + ' itens na raiz)</span>';
                } else {
                    statusEl.innerHTML = '<span style="color:#f44336">Erro: ' + (result.errmsg || 'errno ' + result.errno) + '</span>';
                }
            } catch(e) {
                statusEl.innerHTML = '<span style="color:#f44336">Erro: ' + e.message + '</span>';
            }
        };
    }

    function importStatsCSV() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const text = ev.target.result;
                const lines = text.split(/\r?\n/).filter(l => l.trim());
                if (lines.length < 2) {
                    alert('CSV vazio ou sem dados.');
                    return;
                }
                const header = parseCSVLine(lines[0]).map(h => h.trim());
                const colMap = {};
                header.forEach((h, i) => { colMap[h] = i; });

                const matchMap = {};
                for (let i = 1; i < lines.length; i++) {
                    const cols = parseCSVLine(lines[i]);
                    const matchId = cols[colMap['MatchID']] || '';
                    if (!matchId) continue;

                    if (!matchMap[matchId]) {
                        matchMap[matchId] = {
                            matchId,
                            date: '',
                            homeTeam: '',
                            awayTeam: '',
                            homeScore: '',
                            awayScore: [],
                            playerStats: [],
                            teamSummaryStats: []
                        };
                    }

                    matchMap[matchId].playerStats.push({
                        matchId,
                        teamSide: cols[colMap['TeamSide']] || '',
                        playerID: cols[colMap['PlayerID']] || '',
                        shirtNumber: cols[colMap['ShirtNumber']] || '',
                        playerName: (cols[colMap['PlayerName']] || '').replace(/"/g, ''),
                        position: cols[colMap['Position']] || '',
                        minutes: cols[colMap['Minutes']] || '',
                        goals: cols[colMap['Goals']] || '',
                        assists: cols[colMap['Assists']] || '',
                        shots: cols[colMap['Shots']] || '',
                        shotPct: cols[colMap['ShotPct']] || '',
                        shotsOnTarget: cols[colMap['ShotsOnTarget']] || '',
                        shotAccuracyPct: cols[colMap['ShotAccuracyPct']] || '',
                        autoGoals: cols[colMap['AutoGoals']] || '',
                        passes: cols[colMap['Passes']] || '',
                        successfulPasses: cols[colMap['SuccessfulPasses']] || '',
                        failedPasses: cols[colMap['FailedPasses']] || '',
                        passAccuracyPct: cols[colMap['PassAccuracyPct']] || '',
                        avgPassDist: cols[colMap['AvgPassDist']] || '',
                        interceptions: cols[colMap['Interceptions']] || '',
                        tackles: cols[colMap['Tackles']] || '',
                        successfulTackles: cols[colMap['SuccessfulTackles']] || '',
                        failedTackles: cols[colMap['FailedTackles']] || '',
                        tacklePct: cols[colMap['TacklePct']] || '',
                        possessionMin: cols[colMap['PossessionMin']] || '',
                        possessionPct: cols[colMap['PossessionPct']] || '',
                        distance: cols[colMap['Distance']] || '',
                        distanceWithBall: cols[colMap['DistanceWithBall']] || '',
                        speedWithBall: cols[colMap['SpeedWithBall']] || '',
                        runningSpeed: cols[colMap['RunningSpeed']] || '',
                        corners: cols[colMap['Corners']] || '',
                        freeKicks: cols[colMap['FreeKicks']] || '',
                        penaltiesWon: cols[colMap['PenaltiesWon']] || '',
                        yellowCards: cols[colMap['YellowCards']] || '',
                        redCards: cols[colMap['RedCards']] || '',
                        saves: cols[colMap['Saves']] || ''
                    });
                }

                const imported = saveStats(Object.values(matchMap));
                alert(`Importação concluída!\n${imported.added} novos jogos com estatísticas importados.\nTotal: ${imported.total} jogos.`);
            };
            reader.readAsText(file);
        };
        input.click();
    }

    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (i + 1 < line.length && line[i + 1] === '"') {
                        current += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    current += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    result.push(current);
                    current = '';
                } else {
                    current += ch;
                }
            }
        }
        result.push(current);
        return result;
    }

    function importCSV() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const text = ev.target.result;
                const lines = text.split(/\r?\n/).filter(l => l.trim());
                if (lines.length < 2) {
                    alert('CSV vazio ou sem dados.');
                    return;
                }
                const header = parseCSVLine(lines[0]).map(h => h.trim());
                const colMap = {};
                header.forEach((h, i) => { colMap[h] = i; });

                const existing = loadMatches();
                const seenIds = new Set(existing.map(m => m.matchId));
                let imported = 0;
                let skipped = 0;

                for (let i = 1; i < lines.length; i++) {
                    const cols = parseCSVLine(lines[i]);
                    const matchId = cols[colMap['MatchID']] || '';
                    if (!matchId || seenIds.has(matchId)) {
                        if (matchId && seenIds.has(matchId)) skipped++;
                        continue;
                    }

                    const homeScore = cols[colMap['NossoScore']] || '';
                    const theirScore = cols[colMap['AdversarioScore']] || '';
                    const result = cols[colMap['Resultado']] || 'pending';
                    const homeTeam = cols[colMap['Casa']] || '';
                    const awayTeam = cols[colMap['Fora']] || '';

                    const match = {
                        date: cols[colMap['Data']] || '',
                        time: cols[colMap['Hora']] || '',
                        season: cols[colMap['Época']] || '',
                        type: cols[colMap['Tipo']] || '',
                        competition: cols[colMap['Nome da Competição']] || '',
                        category: cols[colMap['Categoria']] || 'Desconhecido',
                        homeElo: cols[colMap['ELOCasa']] || '',
                        homeTeam,
                        homeValue: cols[colMap['ValorCasa']] || '',
                        awayTeam,
                        awayValue: cols[colMap['ValorFora']] || '',
                        awayElo: cols[colMap['ELOFora']] || '',
                        homeScore: result === 'pending' ? '' : (homeTeam === OUR_TEAM_NAME ? homeScore : theirScore),
                        awayScore: result === 'pending' ? '' : (homeTeam === OUR_TEAM_NAME ? theirScore : homeScore),
                        ourScore: homeScore,
                        theirScore,
                        matchId,
                        tactic: cols[colMap['Tática']] || '',
                        isHome: homeTeam === OUR_TEAM_NAME,
                        isAway: awayTeam === OUR_TEAM_NAME,
                        result
                    };

                    existing.push(match);
                    seenIds.add(matchId);
                    imported++;
                }

                if (imported > 0) {
                    GM_setValue('zoe_matches', JSON.stringify(existing));
                }

                const statusEl = document.getElementById('zoe-status');
                if (statusEl) {
                    statusEl.innerHTML = `<span style="color:#4caf50">Importação concluída: ${imported} novos jogos importados${skipped > 0 ? `, ${skipped} ignorados (duplicados)` : ''}.</span>`;
                }

                alert(`Importação concluída!\n${imported} novos jogos importados.\n${skipped > 0 ? skipped + ' ignorados (já existentes).' : ''}`);

                const panel = document.getElementById('zoe-panel');
                if (panel) {
                    panel.remove();
                    showDataPanel();
                }
                const all = loadMatches();
                updateBadgeUI(all);
                updateEloBtnVisibility();
                updateValueBtnVisibility();
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // --- Floating ZOE Icon ---
    function injectFloatingIcon() {
        if (document.getElementById('zoe-float-icon')) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'zoe-float-icon';
        wrapper.style.cssText = 'position:fixed;top:12px;right:12px;z-index:9999999;font-family:Arial,sans-serif';

        const icon = document.createElement('div');
        icon.style.cssText = 'width:44px;height:44px;cursor:pointer;border-radius:50%;background:#1a1a2e;border:2px solid #e94560;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(233,69,96,0.4);transition:all 0.2s';
        icon.innerHTML = '<svg width="28" height="28" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="#e94560" stroke-width="4"/><text x="50" y="62" text-anchor="middle" font-size="40" font-weight="bold" fill="#e94560" font-family="Arial,sans-serif">Z</text></svg>';
        icon.onmouseenter = () => { icon.style.boxShadow = '0 2px 20px rgba(233,69,96,0.7)'; icon.style.transform = 'scale(1.08)'; };
        icon.onmouseleave = () => { icon.style.boxShadow = '0 2px 12px rgba(233,69,96,0.4)'; icon.style.transform = 'scale(1)'; };

        const menu = document.createElement('div');
        menu.id = 'zoe-float-menu';
        menu.style.cssText = 'display:none;position:absolute;top:52px;right:0;background:#1a1a2e;border:1px solid #e94560;border-radius:8px;padding:6px 0;min-width:200px;box-shadow:0 4px 20px rgba(0,0,0,0.6)';

        const items = [
            { label: 'Buscar jogos', icon: '🔄', action: async () => {
                const s = document.getElementById('zoe-status');
                if (s) s.textContent = 'A buscar jogos...';
                await pollMatches();
                await new Promise(r => waitForEloEnrichment(20000, 2000, r));
                await enrichMatchesWithValues();
                if (s) s.textContent = 'Concluído.';
            }},
            { label: 'Extrair ELO', icon: '📊', action: () => {
                const s = document.getElementById('zoe-status');
                const eloEntries = [];
                document.querySelectorAll('#fixtures-results-list dd.odd, #fixtures-results-list dd.even').forEach(dd => {
                    const entry = extractEloFromMatchRow(dd);
                    if (entry) eloEntries.push(entry);
                });
                if (eloEntries.length > 0) {
                    const updated = applyEloToMatches(eloEntries);
                    if (s) s.innerHTML = updated
                        ? '<span style="color:#4caf50">ELO: ' + eloEntries.length + ' jogos extraídos.</span>'
                        : 'ELO: ' + eloEntries.length + ' lidos, sem alterações.';
                } else {
                    if (s) s.innerHTML = '<span style="color:#ff9800">ELO: nenhum dado encontrado no DOM.</span>';
                }
                updateBadgeUI(loadMatches());
            }},
            { label: 'Extrair Valores', icon: '💰', action: () => enrichMatchesWithValues() },
            { label: 'Extrair Stats', icon: '📋', action: async () => {
                const s = document.getElementById('zoe-status');
                if (s) s.textContent = 'A extrair estatísticas...';
                const r = await extractLastNMatchStats(5);
                if (s) s.innerHTML = '<span style="color:#4caf50">Stats: ' + r.extracted + ' extraídas, ' + r.failed + ' falhadas.</span>';
                updateBadgeUI(loadMatches());
            }},
            { divider: true },
            { label: 'Backup TeraBox', icon: '☁', action: async () => {
                if (!isTeraboxConfigured()) { showTeraboxConfigDialog(); return; }
                const s = document.getElementById('zoe-status');
                if (s) s.textContent = 'A fazer backup...';
                try {
                    const result = await backupToTerabox();
                    if (result.errors.length === 0) {
                        if (s) s.innerHTML = '<span style="color:#4caf50">Backup: ' + result.uploaded + ' ficheiro(s)!</span>';
                    } else {
                        if (s) s.innerHTML = '<span style="color:#ff9800">Backup com erros. Ver consola.</span>';
                    }
                } catch(e) {
                    if (s) s.innerHTML = '<span style="color:#f44336">Erro: ' + e.message + '</span>';
                }
            }},
            { label: 'Backup script (GitHub)', icon: '📦', action: async () => {
                if (!isTeraboxConfigured()) { showTeraboxConfigDialog(); return; }
                const config = getTeraboxConfig();
                if (!config || !config.githubRawUrl) { showTeraboxConfigDialog(); return; }
                const s = document.getElementById('zoe-status');
                if (s) s.textContent = 'A buscar script do GitHub...';
                try {
                    const result = await backupScriptFromGitHub();
                    if (result) {
                        if (s) s.innerHTML = '<span style="color:#4caf50">Script backup: ' + result.lineCount + ' linhas!</span>';
                    } else {
                        if (s) s.innerHTML = '<span style="color:#ff9800">Script sem alterações.</span>';
                    }
                } catch(e) {
                    if (s) s.innerHTML = '<span style="color:#f44336">Erro: ' + e.message + '</span>';
                }
            }},
            { label: 'Configurações', icon: '⚙', action: () => showTeraboxConfigDialog() }
        ];

        items.forEach(item => {
            if (item.divider) {
                const d = document.createElement('div');
                d.style.cssText = 'height:1px;background:#333;margin:4px 8px';
                menu.appendChild(d);
                return;
            }
            const el = document.createElement('div');
            el.style.cssText = 'padding:8px 14px;cursor:pointer;color:#eee;font-size:12px;display:flex;align-items:center;gap:8px;transition:background 0.15s';
            el.innerHTML = '<span style="font-size:14px;width:20px;text-align:center">' + item.icon + '</span>' + item.label;
            el.onmouseenter = () => el.style.background = '#0f3460';
            el.onmouseleave = () => el.style.background = 'transparent';
            el.onclick = (e) => { e.stopPropagation(); menu.style.display = 'none'; item.action(); };
            menu.appendChild(el);
        });

        icon.onclick = (e) => {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        };

        document.addEventListener('click', () => { menu.style.display = 'none'; });

        wrapper.appendChild(icon);
        wrapper.appendChild(menu);
        document.body.appendChild(wrapper);
    }

    // --- Page-specific UI ---
    function tryInjectPageUI() {
        const params = new URLSearchParams(window.location.search);
        const isPlayedPage = params.get('p') === 'match' && params.get('sub') === 'played';

        if (isPlayedPage) {
            const waitForList = setInterval(() => {
                const wrapper = document.getElementById('fixtures-results-list-wrapper');
                const list = document.getElementById('fixtures-results-list');
                if (wrapper && list) {
                    clearInterval(waitForList);
                    injectUI();
                    const all = loadMatches();
                    if (all.length > 0) {
                        updateStatusUI(all, 0);
                    }
                }
            }, 300);
        }
    }

    // --- Init ---
    function init() {
        if (window.self !== window.top) return;
        console.log('ZOE v1.5.0: a iniciar...');
        detectOurTeamName();
        injectFloatingIcon();

        fetchMatchListHTML().then(html => {
            if (html) {
                let rawHtml = html;
                if (typeof html === 'string' && html.trim().startsWith('{')) {
                    try {
                        const json = JSON.parse(html);
                        if (json.list) rawHtml = json.list;
                    } catch(e) {}
                }
                lastRawHtml = rawHtml;
                console.log('ZOE: AJAX HTML guardado (' + rawHtml.length + ' chars)');
            }
        });

        setTimeout(async () => {
            await pollMatches();
            await new Promise(r => waitForEloEnrichment(20000, 2000, r));
            await enrichMatchesWithValues();
            updateStatsBtnVisibility();
            checkAutoBackup();
        }, 8000);

        pollTimer = setInterval(pollMatches, CONFIG.fetchIntervalMs);
        tryInjectPageUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
