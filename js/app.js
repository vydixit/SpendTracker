/**
 * SpendTracker - Main Application
 * Charts, filtering, tagging, localStorage persistence, CSV export
 */

const app = {
    transactions: [],
    filteredTransactions: [],
    charts: {},
    tagModal: null,
    currentTxnId: null,
    sortState: { big: { col: 'amount', dir: 'desc' }, refunds: { col: 'date', dir: 'desc' }, all: { col: 'date', dir: 'desc' } },

    init() {
        this.setupUpload();
        this.loadSavedData();
        this.setupInactivityTimer();
    },

    setupUpload() {
        const uploadBox = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');

        uploadBox.addEventListener('click', (e) => {
            // Don't trigger if clicking the button or input directly
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
            fileInput.click();
        });
        uploadBox.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadBox.classList.add('dragover');
        });
        uploadBox.addEventListener('dragleave', () => {
            uploadBox.classList.remove('dragover');
        });
        uploadBox.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadBox.classList.remove('dragover');
            if (e.dataTransfer.files.length) {
                this.handleFiles(e.dataTransfer.files);
            }
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) {
                this.handleFiles(e.target.files);
            }
        });

        // Import dashboard JSON
        const importInput = document.getElementById('import-input');
        importInput.addEventListener('change', (e) => {
            if (e.target.files.length) {
                this.importDashboard(e.target.files[0]);
                e.target.value = ''; // reset so same file can be re-imported
            }
        });
    },

    async handleFiles(fileList) {
        const files = Array.from(fileList).filter(f => f.name.endsWith('.pdf') || f.name.endsWith('.csv'));
        if (files.length === 0) { alert('Please select PDF or CSV files.'); return; }

        document.getElementById('upload-section').classList.add('hidden');
        document.getElementById('loading').classList.remove('hidden');
        document.querySelector('#loading p').textContent = `Parsing ${files.length} file${files.length > 1 ? 's' : ''}...`;

        try {
            const parser = new StatementParser();
            let allTxns = [];

            for (let i = 0; i < files.length; i++) {
                document.querySelector('#loading p').textContent = `Parsing file ${i + 1} of ${files.length}: ${files[i].name}`;
                let txns;
                if (files[i].name.endsWith('.csv')) {
                    txns = await this.parseCSV(files[i]);
                } else {
                    txns = await parser.parsePDF(files[i]);
                }
                txns.forEach(t => {
                    t.category = parser.categorize(t.description);
                    if (t.category === 'Payment' && !t.isCredit) {
                        t.isCredit = true;
                    }
                    t.sourceFile = files[i].name;
                });
                allTxns = allTxns.concat(txns);
            }

            // Deduplicate by date+description+amount (same txn across overlapping statements)
            const seen = new Set();
            const deduped = [];
            allTxns.forEach(t => {
                const key = t.dateStr + '|' + t.description + '|' + t.amount + '|' + (t.isCredit ? 'cr' : 'dr');
                if (!seen.has(key)) {
                    seen.add(key);
                    deduped.push(t);
                }
            });

            // Sort by date
            deduped.sort((a, b) => a.date - b.date);

            // Load saved tags/notes from localStorage
            const saved = JSON.parse(localStorage.getItem('spendtracker_tags') || '{}');
            deduped.forEach(t => {
                const tagKey = t.dateStr + '|' + t.description + '|' + t.amount;
                if (saved[tagKey]) {
                    t.tag = saved[tagKey].tag || '';
                    t.note = saved[tagKey].note || '';
                }
            });

            this.transactions = deduped;
            this.filteredTransactions = deduped;

            if (files.length > 1) {
                const removedCount = allTxns.length - deduped.length;
                console.log(`Merged ${files.length} files: ${allTxns.length} total txns, ${removedCount} duplicates removed, ${deduped.length} unique.`);
            }

            this.showDashboard();
        } catch (err) {
            alert('Error parsing file: ' + err.message);
            document.getElementById('upload-section').classList.remove('hidden');
            document.getElementById('loading').classList.add('hidden');
            console.error(err);
        }
    },

    async parseCSV(file) {
        const text = await file.text();
        const lines = text.split('\n');
        const transactions = [];
        
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            if (cols.length < 3) continue;
            
            const dateStr = cols[0].trim();
            const description = cols[1].trim();
            const amount = parseFloat(cols[2].replace(/[",]/g, ''));
            
            if (!dateStr || isNaN(amount)) continue;
            
            transactions.push({
                id: 'txn_' + Math.random().toString(36).substring(2, 11),
                date: new Date(dateStr),
                dateStr: dateStr,
                refNumber: cols[3] ? cols[3].trim() : '',
                description: description,
                amount: amount,
                currency: 'INR',
                isCredit: amount < 0,
                tag: '',
                note: ''
            });
        }
        return transactions;
    },

    showDashboard() {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('dashboard').classList.remove('hidden');

        this.updateSummary();
        this.renderCharts();
        this.updateBigTransactions();
        this.renderRefunds();
        this.renderTable();
        this.populateFilters();
    },

    updateSummary() {
        const debits = this.transactions.filter(t => !t.isCredit);
        const credits = this.transactions.filter(t => t.isCredit);

        // Separate payments from refunds
        const payments = credits.filter(t => t.category === 'Payment');
        const refunds = credits.filter(t => t.category !== 'Payment');

        const totalSpent = debits.reduce((s, t) => s + t.amount, 0);
        const totalPayments = payments.reduce((s, t) => s + Math.abs(t.amount), 0);
        const totalRefunds = refunds.reduce((s, t) => s + Math.abs(t.amount), 0);
        const netSpend = totalSpent - totalRefunds;

        // Get unique months
        const months = new Set(this.transactions.map(t => 
            t.date.getFullYear() + '-' + String(t.date.getMonth() + 1).padStart(2, '0')
        ));
        const avgMonthly = months.size > 0 ? totalSpent / months.size : 0;
        
        const biggestTxn = debits.length > 0 ? Math.max(...debits.map(t => t.amount)) : 0;

        document.getElementById('total-spent').textContent = this.formatCurrency(totalSpent);
        document.getElementById('total-received').textContent = this.formatCurrency(totalRefunds);
        document.getElementById('net-spend').textContent = this.formatCurrency(netSpend);
        document.getElementById('avg-monthly').textContent = this.formatCurrency(avgMonthly);
        document.getElementById('total-txns').textContent = this.transactions.length;
        document.getElementById('biggest-txn').textContent = this.formatCurrency(biggestTxn);
    },

    renderCharts() {
        this.renderMonthlyTrend();
        this.renderCategoryChart();
        this.renderSpentVsReceived();
        this.renderTopMerchants();
        this.renderTagChart();
        this.renderRefundTagChart();
    },

    renderMonthlyTrend() {
        const monthly = {};
        this.transactions.filter(t => !t.isCredit).forEach(t => {
            const key = t.date.getFullYear() + '-' + String(t.date.getMonth() + 1).padStart(2, '0');
            monthly[key] = (monthly[key] || 0) + t.amount;
        });

        const labels = Object.keys(monthly).sort();
        const data = labels.map(l => monthly[l]);

        const ctx = document.getElementById('monthly-chart').getContext('2d');
        if (this.charts.monthly) this.charts.monthly.destroy();
        this.charts.monthly = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels.map(l => this.monthLabel(l)),
                datasets: [{
                    label: 'Monthly Spending (INR)',
                    data: data,
                    backgroundColor: 'rgba(79, 70, 229, 0.7)',
                    borderColor: 'rgba(79, 70, 229, 1)',
                    borderWidth: 1,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { callback: v => '₹' + (v/1000).toFixed(0) + 'K' } }
                }
            }
        });
    },

    renderCategoryChart() {
        const cats = {};
        this.transactions.filter(t => !t.isCredit && t.category !== 'Payment').forEach(t => {
            cats[t.category] = (cats[t.category] || 0) + t.amount;
        });

        const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
        const labels = sorted.map(e => e[0]);
        const data = sorted.map(e => e[1]);

        const colors = [
            '#4f46e5', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6',
            '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
            '#14b8a6', '#e11d48'
        ];

        const ctx = document.getElementById('category-chart').getContext('2d');
        if (this.charts.category) this.charts.category.destroy();
        this.charts.category = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors.slice(0, labels.length)
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } }
                }
            }
        });
    },

    renderSpentVsReceived() {
        const monthly = {};
        this.transactions.forEach(t => {
            const key = t.date.getFullYear() + '-' + String(t.date.getMonth() + 1).padStart(2, '0');
            if (!monthly[key]) monthly[key] = { spent: 0, received: 0 };
            if (t.isCredit) {
                monthly[key].received += Math.abs(t.amount);
            } else {
                monthly[key].spent += t.amount;
            }
        });

        const labels = Object.keys(monthly).sort();
        const ctx = document.getElementById('flow-chart').getContext('2d');
        if (this.charts.svr) this.charts.svr.destroy();
        this.charts.svr = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels.map(l => this.monthLabel(l)),
                datasets: [
                    {
                        label: 'Spent',
                        data: labels.map(l => monthly[l].spent),
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'Received Back',
                        data: labels.map(l => monthly[l].received),
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        fill: true,
                        tension: 0.3
                    }
                ]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true, ticks: { callback: v => '₹' + (v/1000).toFixed(0) + 'K' } }
                }
            }
        });
    },

    renderTopMerchants() {
        const merchants = {};
        this.transactions.filter(t => !t.isCredit && t.category !== 'Payment' && t.category !== 'EMI & Finance').forEach(t => {
            const name = t.description.substring(0, 25).trim();
            merchants[name] = (merchants[name] || 0) + t.amount;
        });

        const sorted = Object.entries(merchants).sort((a, b) => b[1] - a[1]).slice(0, 10);
        const ctx = document.getElementById('merchant-chart').getContext('2d');
        if (this.charts.merchants) this.charts.merchants.destroy();
        this.charts.merchants = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: sorted.map(e => e[0]),
                datasets: [{
                    label: 'Amount (INR)',
                    data: sorted.map(e => e[1]),
                    backgroundColor: 'rgba(236, 72, 153, 0.7)',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { callback: v => '₹' + (v/1000).toFixed(0) + 'K' } }
                }
            }
        });
    },

    renderTagChart() {
        const tagged = this.transactions.filter(t => !t.isCredit && t.tag);
        const untagged = this.transactions.filter(t => !t.isCredit && !t.tag);

        const tagTotals = {};
        const tagCounts = {};
        tagged.forEach(t => {
            tagTotals[t.tag] = (tagTotals[t.tag] || 0) + t.amount;
            tagCounts[t.tag] = (tagCounts[t.tag] || 0) + 1;
        });
        const untaggedTotal = untagged.reduce((s, t) => s + t.amount, 0);

        const labels = [...Object.keys(tagTotals), 'Untagged'];
        const data = [...Object.values(tagTotals), untaggedTotal];
        const colors = ['#f59e0b', '#3b82f6', '#10b981', '#94a3b8'];

        const ctx = document.getElementById('tag-chart').getContext('2d');
        if (this.charts.tags) this.charts.tags.destroy();
        this.charts.tags = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors.slice(0, labels.length)
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 12 } } },
                    tooltip: {
                        callbacks: {
                            label: function(ctx) {
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = ((ctx.raw / total) * 100).toFixed(1);
                                return `${ctx.label}: ₹${ctx.raw.toLocaleString('en-IN')} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });

        // Update tag summary stats
        const summaryEl = document.getElementById('tag-summary-stats');
        if (tagged.length === 0) {
            summaryEl.innerHTML = '<p style="color:#94a3b8;">Tag transactions using the ✏️ button to see your breakdown here.</p>';
        } else {
            const totalAll = data.reduce((a, b) => a + b, 0);
            let html = '';
            Object.entries(tagTotals).forEach(([tag, amount]) => {
                const pct = ((amount / totalAll) * 100).toFixed(1);
                const emoji = tag === 'Paid for Relative' ? '👨‍👩‍👧' : tag === 'Paid for Friend' ? '🤝' : '👤';
                html += `<div>${emoji} <strong>${tag}</strong>: ₹${amount.toLocaleString('en-IN')} (${tagCounts[tag]} txns, ${pct}%)</div>`;
            });
            html += `<div style="margin-top:8px;color:#64748b;">🏷️ <strong>Untagged</strong>: ₹${untaggedTotal.toLocaleString('en-IN')} (${untagged.length} txns)</div>`;
            html += `<div style="margin-top:12px;padding-top:8px;border-top:1px solid #e2e8f0;"><strong>Total Tagged</strong>: ${tagged.length} transactions worth ₹${Object.values(tagTotals).reduce((a,b)=>a+b,0).toLocaleString('en-IN')}</div>`;
            summaryEl.innerHTML = html;
        }
    },

    updateBigTransactions() {
        const threshold = parseFloat(document.getElementById('big-threshold').value) || 5000;
        document.getElementById('big-txn-heading').innerHTML = `🔥 Big Transactions (> ₹${threshold.toLocaleString('en-IN')})`;
        const bigFiltered = this.transactions
            .filter(t => !t.isCredit && t.category !== 'Payment' && t.amount >= threshold);
        const big = this.sortRows(bigFiltered, this.sortState.big.col, this.sortState.big.dir);

        const container = document.getElementById('big-transactions');
        container.innerHTML = `<table><thead><tr>${this.sortHeader('big','date','Date')}${this.sortHeader('big','description','Description')}${this.sortHeader('big','category','Category')}${this.sortHeader('big','amount','Amount')}${this.sortHeader('big','tag','Tag')}<th>Note</th></tr></thead><tbody>` +
            big.map(t => `
            <tr>
                <td>${t.dateStr}</td>
                <td>${t.description}</td>
                <td>${t.category}</td>
                <td class="amount-negative">₹${t.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td>
                    ${t.tag ? `<span class="tag tag-${t.tag === 'Paid for Relative' ? 'relative' : t.tag === 'Paid for Friend' ? 'friend' : 'self'}">${t.tag}</span>` : ''}
                    <button class="tag-btn-cell" onclick="app.openTagModal('${t.id}')">&#9999;&#65039;</button>
                </td>
                <td><span class="note-preview" title="${this.escapeHtml(t.note)}">${t.note || '-'}</span></td>
            </tr>
        `).join('') + `</tbody></table>`;
    },

    sortBy(table, col) {
        const s = this.sortState[table];
        if (s.col === col) {
            s.dir = s.dir === 'asc' ? 'desc' : 'asc';
        } else {
            s.col = col;
            s.dir = col === 'amount' ? 'desc' : 'asc';
        }
        if (table === 'big') this.updateBigTransactions();
        else if (table === 'refunds') this.renderRefunds();
        else this.renderTable();
    },

    sortRows(rows, col, dir) {
        return rows.slice().sort((a, b) => {
            let va, vb;
            if (col === 'date') { va = a.date; vb = b.date; }
            else if (col === 'amount') { va = a.amount; vb = b.amount; }
            else if (col === 'description') { va = (a.description || '').toLowerCase(); vb = (b.description || '').toLowerCase(); }
            else if (col === 'category') { va = (a.category || '').toLowerCase(); vb = (b.category || '').toLowerCase(); }
            else if (col === 'tag') { va = (a.tag || '').toLowerCase(); vb = (b.tag || '').toLowerCase(); }
            else { va = a[col]; vb = b[col]; }
            if (va < vb) return dir === 'asc' ? -1 : 1;
            if (va > vb) return dir === 'asc' ? 1 : -1;
            return 0;
        });
    },

    sortHeader(table, col, label) {
        const s = this.sortState[table];
        const arrow = s.col === col ? (s.dir === 'asc' ? ' &#9650;' : ' &#9660;') : '';
        const cls = s.col === col ? 'sortable active-sort' : 'sortable';
        return `<th class="${cls}" onclick="app.sortBy('${table}','${col}')">${label}${arrow}</th>`;
    },

    renderTable() {
        const sorted = this.sortRows(this.filteredTransactions, this.sortState.all.col, this.sortState.all.dir);
        const container = document.getElementById('transactions-table');
        container.innerHTML = `<table><thead><tr>${this.sortHeader('all','date','Date')}${this.sortHeader('all','description','Description')}${this.sortHeader('all','category','Category')}${this.sortHeader('all','amount','Amount')}<th>Currency</th>${this.sortHeader('all','tag','Tag')}<th>Note</th></tr></thead><tbody>` +
            sorted.map(t => `
            <tr>
                <td>${t.dateStr}</td>
                <td>${t.description}</td>
                <td>${t.category}</td>
                <td class="${t.isCredit ? 'amount-positive' : 'amount-negative'}">
                    ${t.isCredit ? '+' : ''}₹${Math.abs(t.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td>${t.currency}</td>
                <td>
                    ${t.tag ? `<span class="tag tag-${t.tag === 'Paid for Relative' ? 'relative' : t.tag === 'Paid for Friend' ? 'friend' : 'self'}">${t.tag}</span>` : ''}
                    <button class="tag-btn-cell" onclick="app.openTagModal('${t.id}')">&#9999;&#65039;</button>
                </td>
                <td>
                    <span class="note-preview" title="${this.escapeHtml(t.note)}">${t.note || '-'}</span>
                </td>
            </tr>
        `).join('') + `</tbody></table>`;
    },

    populateFilters() {
        const monthSelect = document.getElementById('month-filter');
        
        // Months
        const months = [...new Set(this.transactions.map(t => 
            t.date.getFullYear() + '-' + String(t.date.getMonth() + 1).padStart(2, '0')
        ))].sort();
        
        monthSelect.innerHTML = '<option value="">All Months</option>' +
            months.map(m => `<option value="${m}">${this.monthLabel(m)}</option>`).join('');
    },

    renderRefunds() {
        const refundsFiltered = this.transactions.filter(t => t.isCredit);
        const refunds = this.sortRows(refundsFiltered, this.sortState.refunds.col, this.sortState.refunds.dir);
        const container = document.getElementById('refunds-table');
        if (refunds.length === 0) {
            container.innerHTML = '<p style="color:#64748b;">No refunds/credits found in this statement.</p>';
            return;
        }
        container.innerHTML = `<table><thead><tr>${this.sortHeader('refunds','date','Date')}${this.sortHeader('refunds','description','Description')}${this.sortHeader('refunds','category','Category')}${this.sortHeader('refunds','amount','Amount')}${this.sortHeader('refunds','tag','Tag')}<th>Note</th></tr></thead><tbody>` +
            refunds.map(t => `
            <tr>
                <td>${t.dateStr}</td>
                <td>${t.description}</td>
                <td>${t.category}</td>
                <td class="amount-positive">+\u20b9${Math.abs(t.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td>
                    ${t.tag ? `<span class="tag tag-${t.tag === 'Paid for Relative' ? 'relative' : t.tag === 'Paid for Friend' ? 'friend' : 'self'}">${t.tag}</span>` : ''}
                    <button class="tag-btn-cell" onclick="app.openTagModal('${t.id}')">&#9999;&#65039;</button>
                </td>
                <td><span class="note-preview" title="${this.escapeHtml(t.note)}">${t.note || '-'}</span></td>
            </tr>
        `).join('') + `</tbody></table>`;
    },

    renderRefundTagChart() {
        const refunds = this.transactions.filter(t => t.isCredit);
        const tagged = refunds.filter(t => t.tag);
        const untagged = refunds.filter(t => !t.tag);

        const tagTotals = {};
        const tagCounts = {};
        tagged.forEach(t => {
            tagTotals[t.tag] = (tagTotals[t.tag] || 0) + Math.abs(t.amount);
            tagCounts[t.tag] = (tagCounts[t.tag] || 0) + 1;
        });
        const untaggedTotal = untagged.reduce((s, t) => s + Math.abs(t.amount), 0);

        const labels = [...Object.keys(tagTotals), 'Untagged'];
        const data = [...Object.values(tagTotals), untaggedTotal];
        const colors = ['#f59e0b', '#3b82f6', '#10b981', '#94a3b8'];

        const ctx = document.getElementById('refund-tag-chart').getContext('2d');
        if (this.charts.refundTags) this.charts.refundTags.destroy();
        this.charts.refundTags = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors.slice(0, labels.length)
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 12 } } },
                    tooltip: {
                        callbacks: {
                            label: function(ctx) {
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = ((ctx.raw / total) * 100).toFixed(1);
                                return `${ctx.label}: \u20b9${ctx.raw.toLocaleString('en-IN')} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });

        // Update refund tag summary
        const summaryEl = document.getElementById('refund-tag-summary-stats');
        if (tagged.length === 0) {
            summaryEl.innerHTML = '<p style="color:#94a3b8;">Tag refunds using the \u270f\ufe0f button to track who returned money.</p>';
        } else {
            const totalAll = data.reduce((a, b) => a + b, 0);
            let html = '';
            Object.entries(tagTotals).forEach(([tag, amount]) => {
                const pct = ((amount / totalAll) * 100).toFixed(1);
                const emoji = tag === 'Paid for Relative' ? '\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67' : tag === 'Paid for Friend' ? '\ud83e\udd1d' : '\ud83d\udc64';
                html += `<div>${emoji} <strong>${tag}</strong>: \u20b9${amount.toLocaleString('en-IN')} (${tagCounts[tag]} refunds, ${pct}%)</div>`;
            });
            html += `<div style="margin-top:8px;color:#64748b;">\ud83c\udff7\ufe0f <strong>Untagged</strong>: \u20b9${untaggedTotal.toLocaleString('en-IN')} (${untagged.length} refunds)</div>`;
            html += `<div style="margin-top:12px;padding-top:8px;border-top:1px solid #e2e8f0;"><strong>Total Refunds</strong>: \u20b9${totalAll.toLocaleString('en-IN')} across ${refunds.length} transactions</div>`;
            summaryEl.innerHTML = html;
        }
    },

    filterTransactions() {
        const search = document.getElementById('search-input').value.toLowerCase();
        const month = document.getElementById('month-filter').value;
        const tag = document.getElementById('tag-filter').value;

        this.filteredTransactions = this.transactions.filter(t => {
            if (search && !t.description.toLowerCase().includes(search) && !t.category.toLowerCase().includes(search)) return false;
            if (month) {
                const txnMonth = t.date.getFullYear() + '-' + String(t.date.getMonth() + 1).padStart(2, '0');
                if (txnMonth !== month) return false;
            }
            if (tag === 'relative' && t.tag !== 'Paid for Relative') return false;
            if (tag === 'friend' && t.tag !== 'Paid for Friend') return false;
            if (tag === 'noted' && !t.note) return false;
            if (tag === 'untagged' && t.tag) return false;
            return true;
        });

        this.renderTable();
    },

    openTagModal(txnId) {
        this.currentTxnId = txnId;
        const txn = this.transactions.find(t => t.id === txnId);
        if (!txn) return;

        document.getElementById('modal-txn-info').innerHTML = 
            `<strong>${txn.description}</strong><br>₹${Math.abs(txn.amount).toLocaleString('en-IN')} on ${txn.dateStr}`;
        document.getElementById('modal-note').value = txn.note || '';

        // Highlight active tag
        const reverseTagMap = { 'Paid for Relative': 'relative', 'Paid for Friend': 'friend', 'Self': 'self' };
        document.querySelectorAll('.tag-btn').forEach(btn => btn.classList.remove('active'));
        if (txn.tag) {
            const dataTag = reverseTagMap[txn.tag] || '';
            document.querySelectorAll('.tag-btn').forEach(btn => {
                if (btn.dataset.tag === dataTag) btn.classList.add('active');
            });
        }

        document.getElementById('tag-modal').classList.remove('hidden');
    },

    setTag(tag) {
        document.querySelectorAll('.tag-btn').forEach(btn => btn.classList.remove('active'));
        if (tag) {
            document.querySelectorAll('.tag-btn').forEach(btn => {
                if (btn.dataset.tag === tag) btn.classList.add('active');
            });
        }
    },

    saveTag() {
        const txn = this.transactions.find(t => t.id === this.currentTxnId);
        if (!txn) return;

        const activeBtn = document.querySelector('.tag-btn.active');
        const tagMap = { relative: 'Paid for Relative', friend: 'Paid for Friend', self: 'Self' };
        const tagKey = activeBtn ? activeBtn.dataset.tag : '';
        txn.tag = tagMap[tagKey] || '';
        txn.note = document.getElementById('modal-note').value;

        // Save to localStorage
        const saved = JSON.parse(localStorage.getItem('spendtracker_tags') || '{}');
        const key = txn.dateStr + '|' + txn.description + '|' + txn.amount;
        saved[key] = { tag: txn.tag, note: txn.note };
        localStorage.setItem('spendtracker_tags', JSON.stringify(saved));

        this.closeModal();
        this.renderTable();
        this.updateBigTransactions();
        this.renderRefunds();
        this.renderTagChart();
        this.renderRefundTagChart();
    },

    closeModal() {
        document.getElementById('tag-modal').classList.add('hidden');
        this.currentTxnId = null;
    },

    showExportModal() {
        document.getElementById('export-modal').classList.remove('hidden');
    },

    closeExportModal() {
        document.getElementById('export-modal').classList.add('hidden');
    },

    exportPDF() {
        const opts = {
            summary: document.getElementById('exp-summary').checked,
            all: document.getElementById('exp-all').checked,
            tagged: document.getElementById('exp-tagged').checked,
            relative: document.getElementById('exp-relative').checked,
            friend: document.getElementById('exp-friend').checked,
            self: document.getElementById('exp-self').checked,
            big: document.getElementById('exp-big').checked,
            refunds: document.getElementById('exp-refunds').checked
        };

        // Build filtered transaction sets
        let txnSections = [];

        if (opts.all) {
            txnSections.push({ title: 'All Transactions', data: this.transactions });
        }
        if (opts.tagged) {
            txnSections.push({ title: 'Tagged Transactions', data: this.transactions.filter(t => t.tag) });
        }
        if (opts.relative) {
            txnSections.push({ title: 'Paid for Relative', data: this.transactions.filter(t => t.tag === 'Paid for Relative') });
        }
        if (opts.friend) {
            txnSections.push({ title: 'Paid for Friend', data: this.transactions.filter(t => t.tag === 'Paid for Friend') });
        }
        if (opts.self) {
            txnSections.push({ title: 'Self', data: this.transactions.filter(t => t.tag === 'Self') });
        }
        if (opts.big) {
            const threshold = parseFloat(document.getElementById('big-threshold').value) || 5000;
            txnSections.push({
                title: `Big Transactions (> ₹${threshold.toLocaleString('en-IN')})`,
                data: this.transactions.filter(t => !t.isCredit && t.category !== 'Payment' && t.amount >= threshold).sort((a, b) => b.amount - a.amount)
            });
        }
        if (opts.refunds) {
            txnSections.push({ title: 'Refunds & Credits', data: this.transactions.filter(t => t.isCredit) });
        }

        // Compute summaries
        const debits = this.transactions.filter(t => !t.isCredit);
        const credits = this.transactions.filter(t => t.isCredit);
        const payments = credits.filter(t => t.category === 'Payment');
        const refunds = credits.filter(t => t.category !== 'Payment');
        const totalSpent = debits.reduce((s, t) => s + t.amount, 0);
        const totalRefunds = refunds.reduce((s, t) => s + Math.abs(t.amount), 0);
        const totalPayments = payments.reduce((s, t) => s + Math.abs(t.amount), 0);
        const netSpend = totalSpent - totalRefunds;
        const months = new Set(this.transactions.map(t =>
            t.date.getFullYear() + '-' + String(t.date.getMonth() + 1).padStart(2, '0')
        ));
        const avgMonthly = months.size > 0 ? totalSpent / months.size : 0;

        // Tag summaries
        const tagTotals = {};
        const tagCounts = {};
        this.transactions.filter(t => !t.isCredit && t.tag).forEach(t => {
            tagTotals[t.tag] = (tagTotals[t.tag] || 0) + t.amount;
            tagCounts[t.tag] = (tagCounts[t.tag] || 0) + 1;
        });
        const totalTaggedAmount = Object.values(tagTotals).reduce((a, b) => a + b, 0);
        const totalTaggedCount = Object.values(tagCounts).reduce((a, b) => a + b, 0);

        // Capture chart images
        const chartImages = {};
        const chartIds = ['monthly-chart', 'category-chart', 'flow-chart', 'merchant-chart', 'tag-chart', 'refund-tag-chart'];
        const chartLabels = ['Monthly Spending Trend', 'Spending by Category', 'Spent vs Received', 'Top Merchants', 'Spending by Tag', 'Refunds by Tag'];
        chartIds.forEach((id, i) => {
            const canvas = document.getElementById(id);
            if (canvas) {
                try { chartImages[chartLabels[i]] = canvas.toDataURL('image/png'); } catch(e) {}
            }
        });

        // Build HTML for PDF
        let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
        <title>SpendTracker Report</title>
        <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; color: #1e293b; font-size: 11pt; }
            h1 { color: #4f46e5; border-bottom: 2px solid #4f46e5; padding-bottom: 8px; }
            h2 { color: #334155; margin-top: 30px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
            .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }
            .summary-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
            .summary-card .label { font-size: 0.8rem; color: #64748b; text-transform: uppercase; }
            .summary-card .value { font-size: 1.3rem; font-weight: 700; margin-top: 4px; }
            .spent { border-left: 4px solid #ef4444; }
            .received { border-left: 4px solid #10b981; }
            .net { border-left: 4px solid #4f46e5; }
            .avg { border-left: 4px solid #f59e0b; }
            .payments { border-left: 4px solid #8b5cf6; }
            .count { border-left: 4px solid #ec4899; }
            .tagged-total { border-left: 4px solid #f59e0b; background: #fffbeb; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 10pt; }
            th { background: #f1f5f9; padding: 8px 10px; text-align: left; font-size: 0.8rem; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
            td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
            tr:nth-child(even) { background: #f8fafc; }
            .credit { color: #10b981; font-weight: 600; }
            .debit { color: #ef4444; font-weight: 600; }
            .tag { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; }
            .tag-relative { background: #fef3c7; color: #92400e; }
            .tag-friend { background: #dbeafe; color: #1e40af; }
            .tag-self { background: #d1fae5; color: #065f46; }
            .tag-summary { margin: 10px 0; }
            .tag-summary div { padding: 4px 0; }
            .chart-img { max-width: 100%; height: auto; margin: 10px 0; page-break-inside: avoid; }
            .charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
            .chart-block { text-align: center; page-break-inside: avoid; }
            .chart-block h3 { font-size: 0.9rem; color: #475569; margin-bottom: 8px; }
            .footer { margin-top: 30px; font-size: 0.8rem; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 10px; }
            @media print { body { padding: 10px; } }
        </style></head><body>`;

        html += `<h1>💰 SpendTracker Report</h1>`;
        html += `<p style="color:#64748b;">Generated on ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} | ${this.transactions.length} transactions</p>`;

        // Summary section
        if (opts.summary) {
            html += `<h2>📊 Summary</h2>`;
            html += `<div class="summary-grid">`;
            html += `<div class="summary-card spent"><div class="label">Total Spent</div><div class="value">${this.formatCurrency(totalSpent)}</div></div>`;
            html += `<div class="summary-card received"><div class="label">Refunds Received</div><div class="value">${this.formatCurrency(totalRefunds)}</div></div>`;
            html += `<div class="summary-card net"><div class="label">Net Spend</div><div class="value">${this.formatCurrency(netSpend)}</div></div>`;
            html += `<div class="summary-card avg"><div class="label">Avg Monthly Spend</div><div class="value">${this.formatCurrency(avgMonthly)}</div></div>`;
            html += `<div class="summary-card payments"><div class="label">Bill Payments Made</div><div class="value">${this.formatCurrency(totalPayments)}</div></div>`;
            html += `<div class="summary-card count"><div class="label">Total Transactions</div><div class="value">${this.transactions.length}</div></div>`;
            html += `</div>`;

            // Tag breakdown in summary
            if (Object.keys(tagTotals).length > 0) {
                html += `<div class="tag-summary"><strong>Tagged Spending:</strong>`;
                Object.entries(tagTotals).forEach(([tag, amount]) => {
                    const emoji = tag === 'Paid for Relative' ? '👨‍👩‍👧' : tag === 'Paid for Friend' ? '🤝' : '👤';
                    html += `<div>${emoji} ${tag}: ${this.formatCurrency(amount)} (${tagCounts[tag]} transactions)</div>`;
                });
                html += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0;"><strong>Total Tagged: ${this.formatCurrency(totalTaggedAmount)} across ${totalTaggedCount} transactions</strong></div>`;
                html += `</div>`;
            }

            // Charts
            const chartEntries = Object.entries(chartImages);
            if (chartEntries.length > 0) {
                html += `<h2>\ud83d\udcca Charts</h2>`;
                html += `<div class="charts-grid">`;
                chartEntries.forEach(([label, dataUrl]) => {
                    html += `<div class="chart-block"><h3>${label}</h3><img class="chart-img" src="${dataUrl}"></div>`;
                });
                html += `</div>`;
            }
        }

        // Transaction sections
        txnSections.forEach(section => {
            if (section.data.length === 0) {
                html += `<h2>${section.title}</h2><p style="color:#94a3b8;">No transactions in this category.</p>`;
                return;
            }
            const sectionTotal = section.data.reduce((s, t) => s + (t.isCredit ? -Math.abs(t.amount) : t.amount), 0);
            html += `<h2>${section.title} (${section.data.length} transactions | Total: ${this.formatCurrency(Math.abs(sectionTotal))})</h2>`;
            html += `<table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th><th>Tag</th><th>Note</th></tr></thead><tbody>`;
            section.data.forEach(t => {
                const tagClass = t.tag === 'Paid for Relative' ? 'relative' : t.tag === 'Paid for Friend' ? 'friend' : 'self';
                html += `<tr>
                    <td>${t.dateStr}</td>
                    <td>${this.escapeHtml(t.description)}</td>
                    <td>${t.category}</td>
                    <td class="${t.isCredit ? 'credit' : 'debit'}">${t.isCredit ? '+' : ''}₹${Math.abs(t.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td>${t.tag ? `<span class="tag tag-${tagClass}">${t.tag}</span>` : ''}</td>
                    <td>${this.escapeHtml(t.note) || ''}</td>
                </tr>`;
            });
            html += `</tbody></table>`;
        });

        html += `<div class="footer">Generated by SpendTracker | Data processed locally - no data was transmitted</div>`;
        html += `</body></html>`;

        // Open in new window for print/save as PDF
        const printWin = window.open('', '_blank');
        printWin.document.write(html);
        printWin.document.close();
        printWin.onload = () => {
            setTimeout(() => printWin.print(), 500);
        };

        this.closeExportModal();
    },

    exportCSV() {
        const headers = ['Date', 'Description', 'Category', 'Amount', 'Type', 'Currency', 'Tag', 'Note'];
        const rows = this.filteredTransactions.map(t => [
            t.dateStr,
            `"${t.description.replace(/"/g, '""')}"`,
            t.category,
            t.amount,
            t.isCredit ? 'Credit' : 'Debit',
            t.currency,
            t.tag,
            `"${(t.note || '').replace(/"/g, '""')}"`
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'spend_tracker_export.csv';
        a.click();
        URL.revokeObjectURL(url);
    },

    loadSavedData() {
        // Show saved dashboards if any exist
        const dashboards = JSON.parse(localStorage.getItem('spendtracker_dashboards') || '[]');
        if (dashboards.length > 0) {
            document.getElementById('saved-dashboards').classList.remove('hidden');
            this.renderSavedList(dashboards);
        }
    },

    renderSavedList(dashboards) {
        const list = document.getElementById('saved-list');
        list.innerHTML = dashboards.map((d, i) => `
            <div class="saved-item">
                <div class="saved-item-info" onclick="app.loadDashboard(${i})">
                    <span class="saved-item-name">${this.escapeHtml(d.name)}</span>
                    <span class="saved-item-meta">${d.txnCount} transactions | Saved ${d.savedDate}</span>
                </div>
                <div class="saved-item-actions">
                    <button class="btn-load" onclick="app.loadDashboard(${i})">Load</button>
                    <button class="btn-delete" onclick="app.deleteDashboard(${i})">Delete</button>
                </div>
            </div>
        `).join('');
    },

    saveDashboard() {
        const name = prompt('Name this dashboard (e.g., "Apr 2025 - Mar 2026"):');
        if (!name) return;

        // Sanitize transactions for storage - strip any remaining sensitive data
        const sanitized = this.transactions.map(t => ({
            dateStr: t.dateStr,
            description: t.description, // Already PII-redacted by parser
            amount: t.amount,
            currency: t.currency,
            isCredit: t.isCredit,
            category: t.category,
            tag: t.tag,
            note: this.sanitizeNote(t.note)
        }));

        const dashboard = {
            name: name.substring(0, 50),
            savedDate: new Date().toLocaleDateString('en-IN'),
            txnCount: sanitized.length,
            transactions: sanitized
        };

        // Download as JSON file to saved/ folder
        const filename = name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40) + '_' + new Date().toISOString().slice(0, 10) + '.json';
        const blob = new Blob([JSON.stringify(dashboard, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        // Also keep in localStorage for quick access
        const dashboards = JSON.parse(localStorage.getItem('spendtracker_dashboards') || '[]');
        dashboards.push(dashboard);
        localStorage.setItem('spendtracker_dashboards', JSON.stringify(dashboards));

        const status = document.getElementById('save-status');
        status.textContent = `✓ Saved & downloaded as ${filename}`;
        setTimeout(() => status.textContent = '', 5000);
    },

    async importDashboard(file) {
        try {
            const text = await file.text();
            const dashboard = JSON.parse(text);

            // Validate structure
            if (!dashboard.transactions || !Array.isArray(dashboard.transactions)) {
                alert('Invalid dashboard file. Must contain a transactions array.');
                return;
            }

            // Reconstruct transaction objects
            this.transactions = dashboard.transactions.map(t => ({
                ...t,
                id: 'txn_' + Math.random().toString(36).substring(2, 11),
                date: this.parseDateStr(t.dateStr),
                refNumber: ''
            }));
            this.filteredTransactions = this.transactions;

            document.getElementById('upload-section').classList.add('hidden');
            this.showDashboard();

            const status = document.getElementById('save-status');
            if (status) {
                status.textContent = `✓ Loaded: ${dashboard.name || file.name}`;
                setTimeout(() => status.textContent = '', 5000);
            }
        } catch (err) {
            alert('Error importing dashboard: ' + err.message);
        }
    },

    loadDashboard(index) {
        const dashboards = JSON.parse(localStorage.getItem('spendtracker_dashboards') || '[]');
        const d = dashboards[index];
        if (!d) return;

        // Reconstruct transaction objects
        this.transactions = d.transactions.map(t => ({
            ...t,
            id: 'txn_' + Math.random().toString(36).substring(2, 11),
            date: this.parseDateStr(t.dateStr),
            refNumber: ''
        }));
        this.filteredTransactions = this.transactions;

        document.getElementById('upload-section').classList.add('hidden');
        this.showDashboard();
    },

    deleteDashboard(index) {
        if (!confirm('Delete this saved dashboard?')) return;
        const dashboards = JSON.parse(localStorage.getItem('spendtracker_dashboards') || '[]');
        dashboards.splice(index, 1);
        localStorage.setItem('spendtracker_dashboards', JSON.stringify(dashboards));
        this.renderSavedList(dashboards);
        if (dashboards.length === 0) {
            document.getElementById('saved-dashboards').classList.add('hidden');
        }
    },

    clearAllData() {
        if (!confirm('This will permanently delete ALL saved dashboards, tags, and notes. Continue?')) return;
        localStorage.removeItem('spendtracker_dashboards');
        localStorage.removeItem('spendtracker_tags');
        localStorage.removeItem('spendtracker_lastfile');
        this.transactions = [];
        this.filteredTransactions = [];
        alert('All data cleared.');
        location.reload();
    },

    closeApp() {
        if (this.transactions.length > 0) {
            if (!confirm('You have an active dashboard. Close SpendTracker?')) return;
        }
        // Clear in-memory data
        this.transactions = [];
        this.filteredTransactions = [];
        Object.values(this.charts).forEach(c => { if (c) c.destroy(); });
        this.charts = {};
        // Try to close the window/tab
        window.close();
        // If window.close() is blocked (not opened by script), show blank page
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#64748b;"><div style="text-align:center"><h1>SpendTracker Closed</h1><p>You can close this tab now.</p><button onclick="location.reload()" style="margin-top:16px;padding:10px 24px;border:none;background:#4f46e5;color:#fff;border-radius:8px;cursor:pointer;font-size:1rem;">Reopen</button></div></div>';
    },

    newUpload() {
        document.getElementById('dashboard').classList.add('hidden');
        document.getElementById('upload-section').classList.remove('hidden');
        this.loadSavedData();
    },

    sanitizeNote(note) {
        if (!note) return '';
        // Redact any PII the user might accidentally type in notes
        let clean = note;
        // Phone numbers
        clean = clean.replace(/\b[6-9]\d{9}\b/g, '[PHONE]');
        clean = clean.replace(/\+91[\s-]?\d{10}\b/g, '[PHONE]');
        // Email
        clean = clean.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
        // PAN
        clean = clean.replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[PAN]');
        // Aadhaar (12 digits)
        clean = clean.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[AADHAAR]');
        // Card numbers (13-19 digits)
        clean = clean.replace(/\b\d{13,19}\b/g, '[CARD]');
        // Bank account (10+ digits)
        clean = clean.replace(/\b\d{10,18}\b/g, '[ACCT]');
        return clean;
    },

    parseDateStr(dateStr) {
        const monthMap = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
        const parts = dateStr.split('-');
        if (parts.length !== 3) return new Date();
        const year = parseInt(parts[2]) > 50 ? 1900 + parseInt(parts[2]) : 2000 + parseInt(parts[2]);
        return new Date(year, monthMap[parts[1]] || 0, parseInt(parts[0]));
    },

    // Inactivity auto-clear (PCI DSS requirement)
    setupInactivityTimer() {
        let timeout;
        const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
        
        const resetTimer = () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                if (this.transactions.length > 0) {
                    this.transactions = [];
                    this.filteredTransactions = [];
                    Object.values(this.charts).forEach(c => c && c.destroy());
                    this.charts = {};
                    document.getElementById('dashboard').classList.add('hidden');
                    document.getElementById('upload-section').classList.remove('hidden');
                    alert('Session expired due to inactivity. Data cleared from memory.');
                    this.loadSavedData();
                }
            }, TIMEOUT_MS);
        };

        ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
            document.addEventListener(evt, resetTimer, { passive: true });
        });
        resetTimer();
    },

    // Helpers
    formatCurrency(amount) {
        return '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    },

    monthLabel(key) {
        const [year, month] = key.split('-');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[parseInt(month) - 1] + ' ' + year.substring(2);
    },

    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => app.init());
