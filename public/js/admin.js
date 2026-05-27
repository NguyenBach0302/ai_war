const Admin = (function() {
    async function show() {
        const list = document.getElementById('admin-unit-list');
        list.innerHTML = '<p class="admin-message">Loading unit data...</p>';
        document.getElementById('admin-overlay').style.display = 'flex';
        
        const res = await fetch('/api/units');
        if (!res.ok) {
            list.innerHTML = '<p class="admin-message error">Unable to load unit data.</p>';
            return;
        }
        const units = await res.json();
        
        list.innerHTML = units.map(u => `
            <div class="admin-unit-card">
                <div class="admin-unit-head">
                    <strong class="admin-unit-title">${escapeHtml(u.icon)} ${escapeHtml(u.name)}</strong>
                    <button class="buy-btn compact-btn" onclick="Admin.update(${Number(u.id)}, '${escapeHtml(u.name)}')">Save</button>
                </div>
                <div class="admin-unit-grid">
                    <div class="auth-input-group">
                        <label>HP</label>
                        <input type="number" id="adm-hp-${u.id}" value="${u.hp}">
                    </div>
                    <div class="auth-input-group">
                        <label>Mana</label>
                        <input type="number" id="adm-mana-${u.id}" value="${u.mana}">
                    </div>
                    <div class="auth-input-group">
                        <label>DMG</label>
                        <input type="number" id="adm-dmg-${u.id}" value="${u.dmg}">
                    </div>
                    <div class="auth-input-group">
                        <label>Atk Spd</label>
                        <input type="number" step="0.1" id="adm-atkspeed-${u.id}" value="${u.atk_speed}">
                    </div>
                    <div class="auth-input-group">
                        <label>Range</label>
                        <input type="number" id="adm-range-${u.id}" value="${u.range}">
                    </div>
                    <div class="auth-input-group">
                        <label>Move Spd</label>
                        <input type="number" step="0.1" id="adm-movespeed-${u.id}" value="${u.move_speed}">
                    </div>
                    <div class="auth-input-group">
                        <label>Armor</label>
                        <input type="number" id="adm-armor-${u.id}" value="${u.armor}">
                    </div>
                    <div class="auth-input-group">
                        <label>M-Res</label>
                        <input type="number" id="adm-mres-${u.id}" value="${u.mres}">
                    </div>
                    <div class="auth-input-group">
                        <label>Crit %</label>
                        <input type="number" step="0.01" id="adm-crit-${u.id}" value="${u.crit_chance}">
                    </div>
                    <div class="auth-input-group">
                        <label>P-Pen %</label>
                        <input type="number" step="0.01" id="adm-ppen-${u.id}" value="${u.phys_pen}">
                    </div>
                    <div class="auth-input-group">
                        <label>M-Pen %</label>
                        <input type="number" step="0.01" id="adm-mpen-${u.id}" value="${u.magic_pen}">
                    </div>
                    <div class="auth-input-group">
                        <label>Dodge %</label>
                        <input type="number" step="0.01" id="adm-dodge-${u.id}" value="${u.dodge ?? 0}">
                    </div>
                    <div class="auth-input-group">
                        <label>Lifesteal %</label>
                        <input type="number" step="0.01" id="adm-lifesteal-${u.id}" value="${u.lifesteal ?? 0}">
                    </div>
                    <div class="auth-input-group">
                        <label>Cost</label>
                        <input type="number" id="adm-cost-${u.id}" value="${u.cost}">
                    </div>
                </div>
            </div>
        `).join('');
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
            cost: parseInt(document.getElementById(`adm-cost-${id}`).value),
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
            alert(`${name} updated successfully!`);
            await Game.fetchUnits();
        } else {
            const data = await res.json();
            alert(`Error: ${data.message}`);
        }
    }

    return { show, update };
})();

