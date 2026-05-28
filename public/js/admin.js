const Admin = (function() {
    let unitsCache = [];
    let selectedUnitId = null;

    function getSelectedUnit() {
        return unitsCache.find(unit => Number(unit.id) === Number(selectedUnitId)) || unitsCache[0] || null;
    }

    function setStatus(message, isError = false) {
        const status = document.getElementById('admin-console-status');
        if (!status) return;
        status.textContent = message || '';
        status.className = isError ? 'admin-message error' : 'admin-message';
    }

    function renderUnitEditor() {
        const list = document.getElementById('admin-unit-list');
        const unit = getSelectedUnit();

        if (!list) return;
        if (!unit) {
            list.innerHTML = '<p class="admin-message error">No unit data available.</p>';
            return;
        }

        list.innerHTML = `
            <div class="admin-toolbar">
                <div class="auth-input-group admin-picker-group">
                    <label for="admin-unit-picker">Selected Unit</label>
                    <select id="admin-unit-picker" class="admin-unit-picker" onchange="Admin.selectUnit(this.value)">
                        ${unitsCache.map(item => `
                            <option value="${Number(item.id)}" ${Number(item.id) === Number(unit.id) ? 'selected' : ''}>
                                ${escapeHtml(item.icon)} ${escapeHtml(item.name)}
                            </option>
                        `).join('')}
                    </select>
                </div>
                <div id="admin-console-status" class="admin-message"></div>
            </div>
            <div class="admin-unit-card">
                <div class="admin-unit-head">
                    <strong class="admin-unit-title">${escapeHtml(unit.icon)} ${escapeHtml(unit.name)}</strong>
                    <button class="buy-btn compact-btn" onclick="Admin.update(${Number(unit.id)}, '${escapeHtml(unit.name)}')">Save</button>
                </div>
                <div class="admin-unit-grid">
                    <div class="auth-input-group">
                        <label>HP</label>
                        <input type="number" id="adm-hp-${unit.id}" value="${unit.hp}">
                    </div>
                    <div class="auth-input-group">
                        <label>Mana</label>
                        <input type="number" id="adm-mana-${unit.id}" value="${unit.mana}">
                    </div>
                    <div class="auth-input-group">
                        <label>DMG</label>
                        <input type="number" id="adm-dmg-${unit.id}" value="${unit.dmg}">
                    </div>
                    <div class="auth-input-group">
                        <label>Atk Spd</label>
                        <input type="number" step="0.1" id="adm-atkspeed-${unit.id}" value="${unit.atk_speed}">
                    </div>
                    <div class="auth-input-group">
                        <label>Range</label>
                        <input type="number" id="adm-range-${unit.id}" value="${unit.range}">
                    </div>
                    <div class="auth-input-group">
                        <label>Move Spd</label>
                        <input type="number" step="0.1" id="adm-movespeed-${unit.id}" value="${unit.move_speed}">
                    </div>
                    <div class="auth-input-group">
                        <label>Armor</label>
                        <input type="number" id="adm-armor-${unit.id}" value="${unit.armor}">
                    </div>
                    <div class="auth-input-group">
                        <label>M-Res</label>
                        <input type="number" id="adm-mres-${unit.id}" value="${unit.mres}">
                    </div>
                    <div class="auth-input-group">
                        <label>Crit %</label>
                        <input type="number" step="0.01" id="adm-crit-${unit.id}" value="${unit.crit_chance}">
                    </div>
                    <div class="auth-input-group">
                        <label>P-Pen %</label>
                        <input type="number" step="0.01" id="adm-ppen-${unit.id}" value="${unit.phys_pen}">
                    </div>
                    <div class="auth-input-group">
                        <label>M-Pen %</label>
                        <input type="number" step="0.01" id="adm-mpen-${unit.id}" value="${unit.magic_pen}">
                    </div>
                    <div class="auth-input-group">
                        <label>Dodge %</label>
                        <input type="number" step="0.01" id="adm-dodge-${unit.id}" value="${unit.dodge ?? 0}">
                    </div>
                    <div class="auth-input-group">
                        <label>Lifesteal %</label>
                        <input type="number" step="0.01" id="adm-lifesteal-${unit.id}" value="${unit.lifesteal ?? 0}">
                    </div>
                    <div class="auth-input-group">
                        <label>Cost</label>
                        <input type="number" id="adm-cost-${unit.id}" value="${unit.cost}">
                    </div>
                </div>
            </div>
        `;
    }

    async function show() {
        const list = document.getElementById('admin-unit-list');
        list.innerHTML = '<p class="admin-message">Loading unit data...</p>';
        document.getElementById('admin-overlay').style.display = 'flex';

        const res = await fetch('/api/units');
        if (!res.ok) {
            list.innerHTML = '<p class="admin-message error">Unable to load unit data.</p>';
            return;
        }

        unitsCache = await res.json();
        selectedUnitId = Number(selectedUnitId || unitsCache[0]?.id || 0);
        renderUnitEditor();
    }

    function selectUnit(id) {
        selectedUnitId = Number(id) || Number(unitsCache[0]?.id || 0);
        renderUnitEditor();
    }

    async function update(id, name) {
        const stats = {
            hp: parseInt(document.getElementById(`adm-hp-${id}`).value),
            mana: parseInt(document.getElementById(`adm-mana-${id}`).value),
            dmg: parseInt(document.getElementById(`adm-dmg-${id}`).value),
            atk_speed: parseFloat(document.getElementById(`adm-atkspeed-${id}`).value),
            range: parseInt(document.getElementById(`adm-range-${id}`).value),
            move_speed: parseFloat(document.getElementById(`adm-movespeed-${id}`).value),
            armor: parseInt(document.getElementById(`adm-armor-${id}`).value),
            mres: parseInt(document.getElementById(`adm-mres-${id}`).value),
            crit_chance: parseFloat(document.getElementById(`adm-crit-${id}`).value),
            phys_pen: parseFloat(document.getElementById(`adm-ppen-${id}`).value),
            magic_pen: parseFloat(document.getElementById(`adm-mpen-${id}`).value),
            dodge: parseFloat(document.getElementById(`adm-dodge-${id}`).value),
            lifesteal: parseFloat(document.getElementById(`adm-lifesteal-${id}`).value),
            cost: parseInt(document.getElementById(`adm-cost-${id}`).value)
        };

        const res = await fetch('/api/admin/units/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Auth.getToken()}`
            },
            body: JSON.stringify({ id, stats })
        });

        if (res.ok) {
            const target = unitsCache.find(unit => Number(unit.id) === Number(id));
            if (target) Object.assign(target, stats);
            setStatus(`${name} updated successfully.`);
            await Game.fetchUnits();
        } else {
            const data = await res.json();
            setStatus(`Error: ${data.message}`, true);
        }
    }

    return { show, selectUnit, update };
})();
