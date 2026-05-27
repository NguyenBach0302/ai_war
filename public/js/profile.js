const Profile = (function() {
    const LOADOUT_UNIT_ALIASES = {
        Hunter: 'Iceman',
        Gunner: 'Gunman'
    };
    let editingSlot = 1;
    let draftLoadouts = null;
    let activeLoadoutSlotDraft = 1;
    let selectedPreviewUnitName = null;
    let lastTapUnitName = null;
    let lastTapAt = 0;
    let lastTapSlotIndex = null;
    let lastTapSlotAt = 0;
    let selectedRosterUnitName = null;
    let pendingFillSlotIndex = null;

    function getOwnedUnits() {
        return Array.isArray(Auth.getUser()?.ownedUnits) ? Auth.getUser().ownedUnits : [];
    }

    function getLoadouts() {
        return Array.isArray(Auth.getUser()?.loadouts) ? Auth.getUser().loadouts : [];
    }

    function jsString(value) {
        return JSON.stringify(String(value || ''));
    }

    function getOwnedUnitMap() {
        return new Map(getOwnedUnits().map(unit => [unit.name, unit]));
    }

    function normalizeDraftUnitNames(unitNames, ownedMap) {
        return [...new Set((Array.isArray(unitNames) ? unitNames : [])
            .map(name => LOADOUT_UNIT_ALIASES[String(name)] || String(name))
            .filter(name => ownedMap.has(name)))].slice(0, 5);
    }

    function buildDraftLoadouts() {
        const user = Auth.getUser();
        const saved = getLoadouts();
        const ownedMap = getOwnedUnitMap();
        draftLoadouts = [1, 2, 3].map(slot => {
            const loadout = saved.find(item => Number(item.slot) === slot) || {};
            return {
                slot,
                name: loadout.name || `Deck ${slot}`,
                unitNames: normalizeDraftUnitNames(loadout.unitNames, ownedMap)
            };
        });
        activeLoadoutSlotDraft = Number(user?.activeLoadoutSlot || 1);
        editingSlot = activeLoadoutSlotDraft;
    }

    function getDraft(slot = editingSlot) {
        if (!draftLoadouts) buildDraftLoadouts();
        return draftLoadouts.find(loadout => Number(loadout.slot) === Number(slot)) || draftLoadouts[0];
    }

    function syncDeckName() {
        const input = document.getElementById(`loadout-name-${editingSlot}`);
        const loadout = getDraft(editingSlot);
        if (input && loadout) loadout.name = input.value.trim() || `Deck ${editingSlot}`;
    }

    function setStatus(message) {
        const status = document.getElementById('profile-status');
        if (status) status.textContent = message || '';
    }

    function getIdleSrc(unitName) {
        return Game.getClassIdleSrc(unitName);
    }

    function getIdleFrameCount(unitName) {
        const idleFrameCounts = {
            Assasin: 6,
            Bowman: 9,
            ChilyGirl: 7,
            Guard: 4,
            Gunner: 7,
            Healer: 8,
            Iceman: 8,
            Mage: 7,
            Sniper: 7
        };
        return idleFrameCounts[unitName] || 1;
    }

    function renderPreview(unit) {
        if (!unit) {
            return `
                <div class="profile-preview-empty">
                    <strong>Hover a class</strong>
                    <span>Class stats and idle animation appear here.</span>
                </div>
            `;
        }
        return `
            <div class="profile-preview-card">
                <div class="profile-preview-stage">
                    <div
                        class="profile-preview-sprite"
                        role="img"
                        aria-label="${escapeHtml(unit.name)} idle"
                        style="--idle-frame-count:${getIdleFrameCount(unit.name)}; --idle-sheet-width:${getIdleFrameCount(unit.name) * 128}px; background-image:url('${getIdleSrc(unit.name)}');"
                    ></div>
                </div>
                <div class="profile-preview-info">
                    <div class="profile-deck-kicker">${escapeHtml(unit.role || 'Unit')}</div>
                    <h3>${escapeHtml(unit.name)}</h3>
                    <p>${escapeHtml(unit.special || 'No special ability')}</p>
                    <div class="profile-preview-stats">
                        <div><span>HP</span><strong>${Number(unit.hp || 0)}</strong></div>
                        <div><span>DMG</span><strong>${Number(unit.dmg || 0)}</strong></div>
                        <div><span>RNG</span><strong>${Number(unit.range || 0)}</strong></div>
                        <div><span>SPD</span><strong>${Number(unit.move_speed || 0)}</strong></div>
                        <div><span>DEF</span><strong>${Number(unit.armor || 0)}/${Number(unit.mres || 0)}</strong></div>
                        <div><span>Cost</span><strong>${Number(unit.cost || 0)}g</strong></div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderPreviewPopup(unit, ownedMap) {
        if (!unit) return '';
        const current = getDraft(editingSlot);
        if (selectedRosterUnitName && !ownedMap.has(selectedRosterUnitName)) selectedRosterUnitName = null;
        const inDeck = current.unitNames.includes(unit.name);
        return `
            <div class="profile-unit-popover">
                <button type="button" class="profile-popover-close" onclick="Profile.closePreview()">x</button>
                ${renderPreview(unit)}
                <button type="button" class="buy-btn primary-action profile-add-btn" onclick='Profile.addUnit(${jsString(unit.name)})' ${inDeck ? 'disabled' : ''}>
                    ${inDeck ? 'Already In Deck' : 'Add to Deck'}
                </button>
            </div>
        `;
    }

    function render() {
        const user = Auth.getUser();
        const summary = document.getElementById('profile-summary');
        const container = document.getElementById('profile-loadouts');
        if (!user || !container) return;
        const ownedUnits = getOwnedUnits().filter(unit => Number(unit.cost || 0) > 0);
        const loadouts = getLoadouts();
        if (summary) {
            summary.innerHTML = `
                <div class="profile-identity">
                    <div class="profile-avatar">${escapeHtml(String(user.username || 'A').slice(0, 2).toUpperCase())}</div>
                    <div>
                        <div class="profile-name">${escapeHtml(user.username)}</div>
                        <div class="profile-caption">Battle Deck Commander</div>
                    </div>
                </div>
                <div class="profile-stats">
                    <div><strong>${Number(user.gold || 0)}</strong><span>Gold</span></div>
                    <div><strong>${Number(user.wins || 0)} / ${Number(user.losses || 0)}</strong><span>W / L</span></div>
                    <div><strong>${ownedUnits.length}</strong><span>Unlocked</span></div>
                </div>
            `;
        }
        if (summary) summary.textContent = `${user.username} Â· ${user.gold} gold Â· ${ownedUnits.length} unlocked base units`;

        if (summary) {
            summary.innerHTML = `
                <div class="profile-identity">
                    <div class="profile-avatar">${escapeHtml(String(user.username || 'A').slice(0, 2).toUpperCase())}</div>
                    <div>
                        <div class="profile-name">${escapeHtml(user.username)}</div>
                        <div class="profile-caption">Battle Deck Commander</div>
                    </div>
                </div>
                <div class="profile-stats">
                    <div><strong>${Number(user.gold || 0)}</strong><span>Gold</span></div>
                    <div><strong>${Number(user.wins || 0)} / ${Number(user.losses || 0)}</strong><span>W / L</span></div>
                    <div><strong>${ownedUnits.length}</strong><span>Unlocked</span></div>
                </div>
            `;
        }

        container.innerHTML = [1, 2, 3].map(slot => {
            const loadout = loadouts.find(item => Number(item.slot) === slot) || { slot, name: `Loadout ${slot}`, unitNames: [] };
            const selected = new Set(Array.isArray(loadout.unitNames) ? loadout.unitNames : []);
            const selectedCount = selected.size;
            return `
                <div class="profile-loadout-card" data-loadout-slot="${slot}">
                    <div class="profile-loadout-head">
                        <div>
                            <div class="profile-deck-kicker">Deck ${slot}</div>
                            <input id="loadout-name-${slot}" value="${escapeHtml(loadout.name || `Loadout ${slot}`)}" maxlength="50">
                        </div>
                        <label class="profile-active ${user.activeLoadoutSlot === slot ? 'is-active' : ''}">
                            <input type="radio" name="active-loadout" value="${slot}" ${user.activeLoadoutSlot === slot ? 'checked' : ''}>
                            Use
                        </label>
                    </div>
                    <div class="profile-deck-meter">
                        <span>${selectedCount}/5 selected</span>
                        <div><i style="width:${Math.min(100, selectedCount * 20)}%"></i></div>
                    </div>
                    <div class="profile-unit-list">
                        ${ownedUnits.map(unit => `
                            <label class="profile-unit-option">
                                <input type="checkbox" data-loadout-unit="${slot}" value="${escapeHtml(unit.name)}" ${selected.has(unit.name) ? 'checked' : ''} onchange="Profile.enforceLimit(${slot}, this)">
                                <span class="profile-unit-art">
                                    <img src="${Game.getClassIconSrc(unit.name)}" alt="${escapeHtml(unit.name)}">
                                </span>
                                <span class="profile-unit-copy">
                                    <span class="profile-unit-name">${escapeHtml(unit.name)}</span>
                                    <span class="profile-unit-role">${escapeHtml(unit.role || 'Unit')}</span>
                                </span>
                                <span class="profile-unit-cost">${Number(unit.cost || 0)}g</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

    function render() {
        const user = Auth.getUser();
        const summary = document.getElementById('profile-summary');
        const container = document.getElementById('profile-loadouts');
        if (!user || !container) return;
        const ownedUnits = getOwnedUnits().filter(unit => Number(unit.cost || 0) > 0);
        if (!draftLoadouts) buildDraftLoadouts();
        const activeSlot = Number(activeLoadoutSlotDraft || user.activeLoadoutSlot || 1);
        const current = getDraft(editingSlot);
        const ownedMap = getOwnedUnitMap();

        if (summary) {
            summary.innerHTML = `
                <div class="profile-identity">
                    <div class="profile-avatar">${escapeHtml(String(user.username || 'A').slice(0, 2).toUpperCase())}</div>
                    <div>
                        <div class="profile-name">${escapeHtml(user.username)}</div>
                        <div class="profile-caption">Battle Deck Commander</div>
                    </div>
                </div>
                <div class="profile-stats">
                    <div><strong>${Number(user.gold || 0)}</strong><span>Gold</span></div>
                    <div><strong>${Number(user.wins || 0)} / ${Number(user.losses || 0)}</strong><span>W / L</span></div>
                    <div><strong>${ownedUnits.length}</strong><span>Unlocked</span></div>
                </div>
            `;
        }

        const previewUnit = selectedPreviewUnitName ? ownedMap.get(selectedPreviewUnitName) : null;

        container.innerHTML = `
            <div class="profile-deck-workbench compact">
                <div class="profile-loadout-card profile-active-deck" data-loadout-slot="${editingSlot}">
                    ${renderPreviewPopup(previewUnit, ownedMap)}
                    <div class="profile-loadout-head">
                        <div>
                            <div class="profile-deck-kicker">Deck Selection</div>
                            <select class="profile-deck-listbox" onchange="Profile.selectDeck(this.value)">
                                ${draftLoadouts.map(loadout => `
                                    <option value="${loadout.slot}" ${loadout.slot === editingSlot ? 'selected' : ''}>Deck ${loadout.slot} - ${escapeHtml(loadout.name)}</option>
                                `).join('')}
                            </select>
                            <input id="loadout-name-${editingSlot}" value="${escapeHtml(current.name)}" maxlength="50" oninput="Profile.syncDeckName()">
                        </div>
                        <label class="profile-active ${activeSlot === editingSlot ? 'is-active' : ''}">
                            <input type="radio" name="active-loadout" value="${editingSlot}" ${activeSlot === editingSlot ? 'checked' : ''} onchange="Profile.setActiveDeck(${editingSlot})">
                            Use Online
                        </label>
                    </div>
                    <div class="profile-deck-meter">
                        <span>${current.unitNames.length}/5 selected</span>
                        <div><i style="width:${Math.min(100, current.unitNames.length * 20)}%"></i></div>
                    </div>
                    <div class="profile-deck-slots" ondragover="Profile.allowDrop(event)" ondrop="Profile.dropUnit(event)">
                        ${Array.from({ length: 5 }).map((_, index) => {
                            const unitName = current.unitNames[index];
                            const unit = unitName ? ownedMap.get(unitName) : null;
                            return unit ? `
                                <div class="profile-deck-slot filled ${pendingFillSlotIndex === index ? 'pending' : ''}" onclick="Profile.selectSlot(${index})" ondragover="Profile.allowDrop(event)" ondrop="Profile.dropUnit(event, ${index})" title="Double click to remove">
                                    <span class="profile-unit-art"><img src="${Game.getClassIconSrc(unit.name)}" alt="${escapeHtml(unit.name)}"></span>
                                </div>
                            ` : `
                                <button type="button" class="profile-deck-slot empty ${pendingFillSlotIndex === index ? 'pending' : ''}" onclick="Profile.fillSlot(${index})" ondragover="Profile.allowDrop(event)" ondrop="Profile.dropUnit(event, ${index})">
                                    <span>+</span>
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>

                <div class="profile-roster-panel">
                    <div class="profile-roster-head">
                        <div>
                            <div class="profile-deck-kicker">Unlocked Roster</div>
                            <strong>Tap a class to inspect, then add it to the deck</strong>
                        </div>
                        <span>${ownedUnits.length} units</span>
                    </div>
                    <div class="profile-roster-grid compact">
                        ${ownedUnits.map(unit => {
                            const inDeck = current.unitNames.includes(unit.name);
                            const selected = selectedRosterUnitName === unit.name;
                            return `
                                <div class="profile-roster-card ${inDeck ? 'in-deck' : ''} ${selected ? 'selected' : ''}" role="button" tabindex="0" draggable="true" onclick='Profile.previewUnit(${jsString(unit.name)})' ondblclick='Profile.addUnit(${jsString(unit.name)})' ondragstart='Profile.dragUnit(event, ${jsString(unit.name)})' title="Double click to add">
                                    <span class="profile-unit-art"><img src="${Game.getClassIconSrc(unit.name)}" alt="${escapeHtml(unit.name)}"></span>
                                    <span class="profile-roster-name">${escapeHtml(unit.name)}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    function show() {
        draftLoadouts = null;
        render();
        const overlay = document.getElementById('profile-overlay');
        if (overlay) overlay.style.display = 'flex';
    }

    function hide() {
        const overlay = document.getElementById('profile-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    function enforceLimit(slot, changedInput) {
        const checked = [...document.querySelectorAll(`[data-loadout-unit="${slot}"]:checked`)];
        if (checked.length <= 5) return;
        changedInput.checked = false;
        const status = document.getElementById('profile-status');
        if (status) status.textContent = 'Each loadout can include up to 5 units.';
    }

    function selectDeck(slot) {
        syncDeckName();
        editingSlot = Number(slot) || 1;
        selectedPreviewUnitName = null;
        selectedRosterUnitName = null;
        pendingFillSlotIndex = null;
        render();
    }

    function setActiveDeck(slot) {
        activeLoadoutSlotDraft = Number(slot) || editingSlot;
        render();
    }

    function allowDrop(event) {
        event.preventDefault();
    }

    function dragUnit(event, unitName) {
        event.dataTransfer.setData('text/unit', unitName);
        event.dataTransfer.effectAllowed = 'copy';
    }

    function addUnit(unitName, replaceIndex = null) {
        syncDeckName();
        const loadout = getDraft(editingSlot);
        const ownedMap = getOwnedUnitMap();
        if (!ownedMap.has(unitName)) return;
        if (loadout.unitNames.includes(unitName) && replaceIndex === null) {
            setStatus(`${unitName} is already in this deck.`);
            return;
        }
        if (!Number.isInteger(replaceIndex)) {
            const emptyIndex = Array.from({ length: 5 }).findIndex((_, index) => !loadout.unitNames[index]);
            if (emptyIndex >= 0) replaceIndex = emptyIndex;
            else if (Number.isInteger(pendingFillSlotIndex)) replaceIndex = pendingFillSlotIndex;
        }
        if (Number.isInteger(replaceIndex)) {
            loadout.unitNames = loadout.unitNames.filter(name => name !== unitName);
            loadout.unitNames[replaceIndex] = unitName;
            loadout.unitNames = loadout.unitNames.filter(Boolean).slice(0, 5);
            selectedPreviewUnitName = null;
            selectedRosterUnitName = null;
            pendingFillSlotIndex = null;
            setStatus('');
            render();
            return;
        }
        if (loadout.unitNames.length >= 5) {
            loadout.unitNames = loadout.unitNames.filter(name => name !== unitName);
            loadout.unitNames[4] = unitName;
            loadout.unitNames = loadout.unitNames.filter(Boolean).slice(0, 5);
            selectedPreviewUnitName = null;
            selectedRosterUnitName = null;
            pendingFillSlotIndex = null;
            setStatus('Deck was full, replaced the last slot.');
            render();
            return;
        }
        loadout.unitNames.push(unitName);
        selectedPreviewUnitName = null;
        selectedRosterUnitName = null;
        pendingFillSlotIndex = null;
        setStatus('');
        render();
    }

    function fillSlot(index) {
        if (!selectedRosterUnitName) {
            pendingFillSlotIndex = index;
            setStatus('Select a unit from the roster to fill this slot.');
            render();
            return;
        }
        addUnit(selectedRosterUnitName, index);
    }

    function selectSlot(index) {
        const now = performance.now();
        if (lastTapSlotIndex === index && now - lastTapSlotAt < 420) {
            lastTapSlotIndex = null;
            lastTapSlotAt = 0;
            removeUnit(index);
            return;
        }
        lastTapSlotIndex = index;
        lastTapSlotAt = now;
        pendingFillSlotIndex = index;
        setStatus('Choose a unit from the roster to replace this slot.');
        render();
    }

    function dropUnit(event, replaceIndex = null) {
        event.preventDefault();
        const unitName = event.dataTransfer.getData('text/unit');
        if (unitName) addUnit(unitName, Number.isInteger(replaceIndex) ? replaceIndex : null);
    }

    function removeUnit(index) {
        syncDeckName();
        const loadout = getDraft(editingSlot);
        loadout.unitNames.splice(index, 1);
        lastTapSlotIndex = null;
        lastTapSlotAt = 0;
        pendingFillSlotIndex = null;
        setStatus('');
        render();
    }

    function previewUnit(unitName) {
        if (Number.isInteger(pendingFillSlotIndex)) {
            const targetIndex = pendingFillSlotIndex;
            addUnit(unitName, targetIndex);
            return;
        }
        selectedRosterUnitName = unitName;
        const now = performance.now();
        if (lastTapUnitName === unitName && now - lastTapAt < 420) {
            lastTapUnitName = null;
            lastTapAt = 0;
            addUnit(unitName);
            return;
        }
        lastTapUnitName = unitName;
        lastTapAt = now;
        selectedPreviewUnitName = unitName;
        render();
    }

    function closePreview() {
        selectedPreviewUnitName = null;
        render();
    }

    async function save() {
        syncDeckName();
        const status = document.getElementById('profile-status');
        const active = Number(activeLoadoutSlotDraft || document.querySelector('input[name="active-loadout"]:checked')?.value || 1);
        const loadouts = (draftLoadouts || []).map(loadout => ({
            slot: loadout.slot,
            name: loadout.name || `Deck ${loadout.slot}`,
            unitNames: loadout.unitNames.slice(0, 5)
        }));

        if (loadouts.some(loadout => loadout.unitNames.length < 1 || loadout.unitNames.length > 5)) {
            if (status) status.textContent = 'Each loadout must include 1-5 units.';
            return;
        }

        try {
            if (status) status.textContent = 'Saving profile...';
            const res = await fetch('/api/user/loadouts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Auth.getToken()}`
                },
                body: JSON.stringify({ activeLoadoutSlot: active, loadouts })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Unable to save profile');
            Auth.setUser(data);
            Game.updateSetupUI();
            const loadoutSelect = document.getElementById('online-loadout-slot');
            if (loadoutSelect) loadoutSelect.value = String(data.activeLoadoutSlot || active);
            render();
            if (status) status.textContent = 'Profile saved.';
        } catch (err) {
            if (status) status.textContent = err.message || 'Unable to save profile.';
        }
    }

    return { show, hide, save, render, selectDeck, setActiveDeck, syncDeckName, allowDrop, dragUnit, dropUnit, addUnit, fillSlot, selectSlot, removeUnit, previewUnit, closePreview };
})();

