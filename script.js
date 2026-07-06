// 1. Global Variables (Top Level Scope)4
let rawData = [];
let processedStories = [];
let holidays = JSON.parse(localStorage.getItem('holidays') || "[]");
let githubToken = localStorage.getItem('gh_token') || "";

// GitHub Configuration
const GH_CONFIG = {
    owner: 'elmoatasemsaeed',
    repo: 'Productivity_Analysis_Dashboard',
    path: 'data.json',
    usersPath: 'users.json',
    branch: 'main'
};

// Initialize Users
let users = JSON.parse(localStorage.getItem('app_users'));
if (!users || Object.keys(users).length === 0) {
    users = {
        "admin": { pass: "admin", role: "admin" }
    };
    localStorage.setItem('app_users', JSON.stringify(users));
}

let currentUser = null;

// Azure configs (for historical sync)
let azureConfigs = [];
let azureConfigsSha = "";
let azurePAT = localStorage.getItem('az_pat') || "";

// Chart instances for historical view
let evChart = null, rwChart = null, ctChart = null, avgWorkloadChart = null;
let resourceDistChart = null, bugSeverityChart = null, bugTypeChart = null;

// --- Functions ---

function saveUsers() {
    localStorage.setItem('app_users', JSON.stringify(users));
    renderUsersTable();
}

async function attemptLogin() {
    const user = document.getElementById('loginUser').value;
    const pass = document.getElementById('loginPass').value;
    const token = document.getElementById('ghTokenInput').value;
    const azurePat = document.getElementById('azurePatInput').value;
    const remember = document.getElementById('rememberMe').checked;

    if (users[user] && users[user].pass === pass) {
        currentUser = { name: user, ...users[user] };
        
        if (remember) {
            localStorage.setItem('gh_token', token);
            localStorage.setItem('azure_pat', azurePat);
            localStorage.setItem('saved_user', user);
            localStorage.setItem('saved_pass', pass);
            localStorage.setItem('app_role', currentUser.role);
        } else {
            localStorage.removeItem('gh_token');
            localStorage.removeItem('azure_pat');
            localStorage.removeItem('saved_user');
            localStorage.removeItem('saved_pass');
        }

        githubToken = token;
        setupPermissions();
        document.getElementById('login-overlay').style.display = 'none';
    } else {
        alert("Invalid credentials");
    }
}

function renderUsersTable() {
    const tbody = document.getElementById('usersListTable');
    if (!tbody || !users) return;
    
    tbody.innerHTML = Object.keys(users).map(u => `
        <tr>
            <td>${u}</td>
            <td>${users[u].pass}</td>
            <td>${users[u].role}</td>
            <td><button onclick="deleteUser('${u}')" style="background:#e74c3c; padding:5px; color:white; border:none; border-radius:3px;">Delete</button></td>
        </tr>
    `).join('');
}

async function addUser() {
    const name = document.getElementById('newUserName').value;
    const pass = document.getElementById('newUserPass').value;
    const role = document.getElementById('newUserRole').value;

    if (name && pass) {
        users[name] = { pass: pass, role: role };
        localStorage.setItem('app_users', JSON.stringify(users));
        await uploadUsersToGitHub();
        alert("User saved and synced to GitHub!");
        document.getElementById('newUserName').value = '';
        document.getElementById('newUserPass').value = '';
        renderUsersTable();
    }
}

async function fetchUsersFromGitHub() {
    try {
        const res = await fetch(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${GH_CONFIG.usersPath}`, {
            headers: { 
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3.raw'
            }
        });
        if (res.ok) {
            const content = await res.text();
            users = JSON.parse(content);
            localStorage.setItem('app_users', JSON.stringify(users));
            renderUsersTable();
        }
    } catch (e) {
        console.error("Error fetching users:", e);
    }
}

async function uploadUsersToGitHub() {
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(users))));
    let sha = "";
    try {
        const res = await fetch(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${GH_CONFIG.usersPath}`, {
            headers: { 'Authorization': `token ${githubToken}` }
        });
        if (res.ok) {
            const data = await res.json();
            sha = data.sha;
        }
        await fetch(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${GH_CONFIG.usersPath}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${githubToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: "Update user list",
                content: content,
                sha: sha,
                branch: GH_CONFIG.branch
            })
        });
    } catch (e) {
        console.error("Error syncing users:", e);
    }
}

function deleteUser(username) {
    if (username === 'admin') return alert("Cannot delete main admin!");
    if (confirm(`Delete user ${username}?`)) {
        delete users[username];
        saveUsers();
    }
}

function setupPermissions() {
    const role = localStorage.getItem('app_role') || (currentUser ? currentUser.role : null);
    const adminElements = document.querySelectorAll('.admin-only');
    adminElements.forEach(el => {
        if (role === 'admin') {
            el.style.setProperty('display', 'inline-block', 'important');
        } else {
            el.style.setProperty('display', 'none', 'important');
        }
    });
}

async function fetchDataFromGitHub() {
    const statusDiv = document.getElementById('sync-status');
    statusDiv.style.display = 'block';
    statusDiv.innerText = "🔍 Fetching data from GitHub...";
    try {
        const res = await fetch(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${GH_CONFIG.path}`, {
            headers: { 
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3.raw'
            }
        });
        if (res.ok) {
            const content = await res.text();
            rawData = JSON.parse(content);
            updateIterationDropdown();
            processData();
            await loadConfigsFromCloud();
            if (typeof renderAzureConfigsTable === 'function') {
                renderAzureConfigsTable();
            }
            showView('iteration-view');
            statusDiv.innerText = "✅ Data loaded from GitHub";
        } else {
            statusDiv.innerText = "❌ No data found on GitHub. Admin must upload first.";
        }
    } catch (e) {
        console.error(e);
        statusDiv.innerText = "❌ Connection Error";
    }
}

function logout() {
    localStorage.removeItem('gh_token');
    localStorage.removeItem('app_role');
    localStorage.removeItem('saved_user');
    localStorage.removeItem('saved_pass');
    location.reload();
}

// ==================== DATA PROCESSING (Existing) ====================
function processData() {
    processedStories = [];
    let currentStory = null;

    rawData.forEach(row => {
        const type = row['Work Item Type'];
        
        if (type === 'User Story') {
            currentStory = {
                id: row['ID'],
                title: row['Title'],
                businessArea: row['Business Area'] || 'General',
                devLead: row['Assigned To'],
                testerLead: row['Assigned To Tester'],
                testedDate: row['Tested Date'],
                activatedDate: row['Activated Date'],
                status: row['State'],
                tasks: [],
                bugs: [],
                reviews: []
            };
            processedStories.push(currentStory);
        } else if (currentStory) {
            if (type === 'Task') currentStory.tasks.push(row);
            if (type === 'Bug') currentStory.bugs.push(row);
            if (type === 'Review') currentStory.reviews.push(row);
        }
    });

    calculateMetrics();
}
// ========== Helper Classification Functions ==========
function classifyBugTitle(title) {
    const t = title.toLowerCase();
    if (t.includes('ui') || t.includes('design') || t.includes('screen') || t.includes('button') || t.includes('layout')) return 'UI';
    if (t.includes('db') || t.includes('data') || t.includes('sql') || t.includes('table') || t.includes('column')) return 'DB';
    if (t.includes('perform') || t.includes('slow') || t.includes('timeout') || t.includes('load')) return 'Performance';
    if (t.includes('logic') || t.includes('rule') || t.includes('calculation') || t.includes('business')) return 'Logic';
    return 'Other';
}

function classifyReviewTitle(title) {
    const t = title.toLowerCase();
    if (t.includes('code') || t.includes('standard') || t.includes('naming') || t.includes('architecture') || t.includes('refactor') || t.includes('style')) return 'Code Standards';
    if (t.includes('business') || t.includes('logic') || t.includes('rule') || t.includes('requirement') || t.includes('function')) return 'Business Logic';
    return 'Other';
}

function calculateMetrics() {
    processedStories = [];
    let currentStory = null;

    rawData.forEach(row => {
        const type = row['Work Item Type'];
        
        if (type === 'User Story') {
            currentStory = {
                id: row['ID'],
                title: row['Title'],
                businessArea: row['Business Area'] || 'General',
                devLead: row['Assigned To'],
                testerLead: row['Assigned To Tester'],
                testedDate: row['Tested Date'],
                activatedDate: row['Activated Date'],
                status: row['State'],
                tasks: [],
                bugs: [],
                reviews: []
            };
            processedStories.push(currentStory);
        } else if (currentStory) {
            if (type === 'Task') currentStory.tasks.push(row);
            if (type === 'Bug') currentStory.bugs.push(row);
            if (type === 'Review') currentStory.reviews.push(row);
        }
    });

    // --- Process each story with enhanced metrics ---
    processedStories.forEach(us => {
        let devOrig = 0, devActual = 0, testOrig = 0, testActual = 0;
        let dbOrig = 0, dbActual = 0, dbNames = new Set(); 

        // 1. Task calculations (Development, Testing, DB)
        us.tasks.forEach(t => {
            const orig = parseFloat(t['Original Estimation']) || 0;
            const actDev = parseFloat(t['TimeSheet_DevActualTime']) || 0; 
            const actTest = parseFloat(t['TimeSheet_TestingActualTime']) || 0;
            const activity = t['Activity'];

            if (activity === 'DB Modification') {
                dbOrig += orig;
                dbActual += actDev; 
                if (t['Assigned To']) dbNames.add(t['Assigned To']); 
            } else if (activity === 'Development') {
                devOrig += orig;
                devActual += actDev;
            } else if (activity === 'Testing') {
                testOrig += orig;
                testActual += actTest;
            }
        });

        us.dbEffort = { 
            orig: dbOrig, 
            actual: dbActual, 
            dev: dbOrig / (dbActual || 1),
            names: Array.from(dbNames).join(', ') || 'N/A'
        };
        us.devEffort = { orig: devOrig, actual: devActual, dev: devOrig / (devActual || 1) };
        us.testEffort = { orig: testOrig, actual: testActual, dev: testOrig / (testActual || 1) };

        let bugOrig = 0, bugActualTotal = 0, bugsNoTimesheet = 0;
        us.severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };

        us.rework = {
            generic: { count: 0, actualTime: 0, severity: { critical: 0, high: 0, medium: 0, low: 0 } },
            specific: { count: 0, actualTime: 0, severity: { critical: 0, high: 0, medium: 0, low: 0 } },
            severity: { critical: 0, high: 0, medium: 0, low: 0 }, 
            timeEstimation: 0,
            actualTime: 0,
            count: 0,
            uatBugsCount: 0,
            iterationBugsCount: 0
        };

        // --- NEW: Arrays for storing titles and categories ---
        us.bugTitles = [];
        us.bugCategories = [];
        us.reviewTitles = [];
        us.reviewActivities = [];
        us.reviewCategories = [];

        us.bugs.forEach(b => {
            const isGeneric = (b['GenericBug'] || "").trim().toLowerCase() === 'yes';
            const bDevAct = parseFloat(b['TimeSheet_DevActualTime']) || 0;
            const bEst = parseFloat(b['Original Estimation']) || 0;
            const sev = b['Severity'] || "";
            const bugType = (b['BugType'] || "").trim().toUpperCase();

            // Store title and category
            const title = b['Title'] || '';
            us.bugTitles.push(title);
            us.bugCategories.push(classifyBugTitle(title));

            if (bugType === 'UAT') {
                us.rework.uatBugsCount++;
            } else {
                us.rework.iterationBugsCount++;
            }

            bugOrig += bEst;
            bugActualTotal += bDevAct;
            if (bDevAct === 0) bugsNoTimesheet++;

            const target = isGeneric ? us.rework.generic : us.rework.specific;
            target.count++;
            target.actualTime += bDevAct;

            if (sev.includes("1 - Critical")) { 
                target.severity.critical++; 
                us.rework.severity.critical++; 
                us.severityCounts.critical++; 
            }
            else if (sev.includes("2 - High")) { 
                target.severity.high++; 
                us.rework.severity.high++; 
                us.severityCounts.high++; 
            }
            else if (sev.includes("3 - Medium")) { 
                target.severity.medium++; 
                us.rework.severity.medium++; 
                us.severityCounts.medium++; 
            }
            else if (sev.includes("4 - Low")) { 
                target.severity.low++; 
                us.rework.severity.low++; 
                us.severityCounts.low++; 
            }
        });

        us.rework.timeEstimation = bugOrig;
        us.rework.actualTime = bugActualTotal;
        us.rework.count = us.bugs.length;
        us.rework.missingTimesheet = bugsNoTimesheet;
        us.rework.deviation = bugOrig / (bugActualTotal || 1);
        us.rework.percentage = (bugActualTotal / (us.devEffort.actual || 1)) * 100;

        // 3. Reviews
        us.reviewStats = {
            estimation: 0,
            devActual: 0, 
            testActual: 0,
            totalActual: 0, 
            devCount: 0,
            testCount: 0,
            count: us.reviews ? us.reviews.length : 0,
            severity: { critical: 0, high: 0, medium: 0, low: 0}
        };

        if (us.reviews) {
            us.reviews.forEach(r => {
                const rEst = parseFloat(r['Original Estimation']) || 0;
                const rDevAct = parseFloat(r['TimeSheet_DevActualTime']) || 0;
                const rTestAct = parseFloat(r['TimeSheet_TestingActualTime']) || 0;
                const activity = r['Activity'];
                const sev = r['Severity'] || "";

                us.reviewStats.estimation += rEst;

                // Store review title and activity/category
                const title = r['Title'] || '';
                us.reviewTitles.push(title);
                us.reviewActivities.push(activity || '');
                us.reviewCategories.push(classifyReviewTitle(title));

                if (activity === 'Development') {
                    us.reviewStats.devActual += rDevAct;
                    us.reviewStats.devCount++;
                } else if (activity === 'Testing') {
                    us.reviewStats.testActual += rTestAct;
                    us.reviewStats.testCount++;
                }

                if (sev.includes("1 - Critical")) us.reviewStats.severity.critical++;
                else if (sev.includes("2 - High")) us.reviewStats.severity.high++;
                else if (sev.includes("3 - Medium")) us.reviewStats.severity.medium++;
                else if (sev.includes("4 - Low")) us.reviewStats.severity.low++;
            });

            us.reviewStats.totalActual = us.reviewStats.devActual + us.reviewStats.testActual;
        }

        // 4. Timeline and Cycle Time
        let minDate = Infinity;
        us.tasks.forEach(t => {
            const taskDate = new Date(t['Activated Date']).getTime();
            if (!isNaN(taskDate) && taskDate < minDate) minDate = taskDate;
        });
        const firstTaskStart = minDate === Infinity ? null : new Date(minDate);
        const storyEndDate = us.testedDate ? new Date(us.testedDate) : null;
        us.cycleTime = calculateCycleTimeDays(firstTaskStart, storyEndDate);

        calculateTimeline(us);
    });
}

function calculateTimeline(us) {
    let tasks = us.tasks;
    if (!tasks || tasks.length === 0) return;

    const isValidDate = (d) => d instanceof Date && !isNaN(d);

    let devTasks = tasks.filter(t => t.Activity !== 'Testing');
    let testingTasks = tasks.filter(t => t.Activity === 'Testing');

    devTasks.sort((a, b) => {
        let dateA = new Date(a['Activated Date'] || 0);
        let dateB = new Date(b['Activated Date'] || 0);
        return dateA - dateB;
    });

    let lastDevExpectedEnd;
    let lastDevActualEnd = null;

    devTasks.forEach((t, index) => {
        let hours = parseFloat(t['Original Estimation']) || 0;
        let finishDateStr = t['Actual End'] || t['Resolved Date']; 
        if (finishDateStr) {
            let actualEnd = new Date(finishDateStr);
            if (isValidDate(actualEnd)) {
                if (!lastDevActualEnd || actualEnd > lastDevActualEnd) {
                    lastDevActualEnd = actualEnd;
                }
            }
        }

        if (index === 0) {
            let taskAct = t['Activated Date'] ? new Date(t['Activated Date']) : new Date(us.activatedDate);
            t.expectedStart = isValidDate(taskAct) ? taskAct : new Date();
        } else {
            t.expectedStart = new Date(lastDevExpectedEnd);
        }

        t.expectedEnd = addWorkHours(t.expectedStart, hours);
        lastDevExpectedEnd = new Date(t.expectedEnd);
    });

    testingTasks.sort((a, b) => parseInt(a.id || 0) - parseInt(b.id || 0));

    let lastTestExpectedEnd = null;

    testingTasks.forEach((t, index) => {
        let hours = parseFloat(t['Original Estimation']) || 0;
        
        if (index === 0) {
            let taskAct = t['Activated Date'] ? new Date(t['Activated Date']) : new Date(us.activatedDate);
            t.expectedStart = isValidDate(taskAct) ? taskAct : new Date();
        } 
        else if (index === 1) {
            if (lastDevActualEnd && isValidDate(lastDevActualEnd)) {
                t.expectedStart = new Date(lastDevActualEnd);
            } else {
                t.expectedStart = new Date(lastTestExpectedEnd);
            }
        } 
        else {
            t.expectedStart = new Date(lastTestExpectedEnd);
        }

        t.expectedEnd = addWorkHours(t.expectedStart, hours);
        lastTestExpectedEnd = new Date(t.expectedEnd);
    });

    let allTasks = [...devTasks, ...testingTasks];
    if (allTasks.length > 0) {
        let endDates = allTasks.map(t => t.expectedEnd).filter(isValidDate);
        if (endDates.length > 0) {
            us.expectedEnd = new Date(Math.max(...endDates));
        }
    }
}

function addWorkHours(startDate, hours) {
    let date = new Date(startDate);
    let remainingMinutes = hours * 60;

    while (remainingMinutes > 0) {
        if (date.getDay() === 5 || date.getDay() === 6 || holidays.includes(date.toISOString().split('T')[0])) {
            date.setDate(date.getDate() + 1);
            date.setHours(9, 0, 0, 0);
            continue;
        }

        let currentHour = date.getHours();
        let currentMinutes = date.getMinutes();
        let minutesUntilEndOfDay = ((17 - currentHour) * 60) - currentMinutes;

        let addedNow = Math.min(remainingMinutes, minutesUntilEndOfDay);
        date.setTime(date.getTime() + (addedNow * 60 * 1000));
        remainingMinutes -= addedNow;

        if (remainingMinutes > 0 || date.getHours() >= 17) {
            date.setDate(date.getDate() + 1);
            date.setHours(9, 0, 0, 0);
        }
    }
    return date;
}

function calculateHourDiff(start, actual) {
    if (!start || !actual || isNaN(new Date(start)) || isNaN(new Date(actual))) return 0;
    
    let startDate = new Date(start);
    let actualDate = new Date(actual);
    
    if (actualDate <= startDate) return 0;

    let totalDiffMinutes = 0;
    let current = new Date(startDate);

    while (current < actualDate) {
        let dayEnd = new Date(current);
        dayEnd.setHours(17, 0, 0, 0);

        if (current.getDay() !== 5 && current.getDay() !== 6 && !holidays.includes(current.toISOString().split('T')[0])) {
            let endOfPeriod = actualDate < dayEnd ? actualDate : dayEnd;
            let diff = (endOfPeriod - current) / (1000 * 60);
            if (diff > 0) totalDiffMinutes += diff;
        }

        current.setDate(current.getDate() + 1);
        current.setHours(9, 0, 0, 0);
    }

    return (totalDiffMinutes / 60).toFixed(1);
}

function calculateCycleTimeDays(startDate, endDate) {
    if (!startDate || !endDate || isNaN(new Date(startDate)) || isNaN(new Date(endDate))) return 0;
    
    let start = new Date(startDate);
    let end = new Date(endDate);
    if (end < start) return 0;

    let days = 0;
    let current = new Date(start);
    current.setHours(0, 0, 0, 0);
    let finalEnd = new Date(end);
    finalEnd.setHours(0, 0, 0, 0);

    while (current <= finalEnd) {
        const dayOfWeek = current.getDay();
        const dateString = current.toISOString().split('T')[0];
        
        if (dayOfWeek !== 5 && dayOfWeek !== 6 && !holidays.includes(dateString)) {
            days++;
        }
        current.setDate(current.getDate() + 1);
    }
    return days;
}

// ==================== RENDERING FUNCTIONS (Existing unchanged except view switching) ====================

function groupBy(arr, key) {
    return arr.reduce((acc, obj) => {
        (acc[obj[key]] = acc[obj[key]] || []).push(obj);
        return acc;
    }, {});
}

function renderIterationView() {
    const container = document.getElementById('iteration-view');
    if (!processedStories || processedStories.length === 0) {
        container.innerHTML = "<div class='card'><h2>Iteration Summary</h2><p>No data available.</p></div>";
        return;
    }

    let globalStats = {
        totalStories: processedStories.length,
        totalEst: 0, 
        totalAct: 0,
        reworkHrs: 0, 
        reviewHrs: 0,
        totalCycleTime: 0, 
        ctCount: 0,
        sev: { crit: 0, high: 0, med: 0, low: 0, totalItems: 0 }
    };

    processedStories.forEach(us => {
        const storyEst = us.devEffort.orig + us.testEffort.orig + (us.dbEffort?.orig || 0);
        const storyReviewTime = (us.reviewStats.devActual + us.reviewStats.testActual);
        const storyAct = us.devEffort.actual + us.testEffort.actual + (us.dbEffort?.actual || 0) + us.rework.actualTime + storyReviewTime;

        globalStats.totalEst += storyEst;
        globalStats.totalAct += storyAct;
        globalStats.reworkHrs += us.rework.actualTime;
        globalStats.reviewHrs += storyReviewTime;

        if (us.cycleTime > 0) {
            globalStats.totalCycleTime += us.cycleTime;
            globalStats.ctCount++;
        }

        const bugs = us.rework.severity;
        const revs = us.reviewStats.severity;
        globalStats.sev.crit += (bugs.critical + revs.critical);
        globalStats.sev.high += (bugs.high + revs.high);
        globalStats.sev.med += (bugs.medium + revs.medium);
        globalStats.sev.low += (bugs.low + revs.low);
    });

    globalStats.sev.totalItems = globalStats.sev.crit + globalStats.sev.high + globalStats.sev.med + globalStats.sev.low;

    const effortVariance = ((globalStats.totalAct - globalStats.totalEst) / (globalStats.totalEst || 1)) * 100;
    const combinedReworkRatio = ((globalStats.reworkHrs + globalStats.reviewHrs) / (globalStats.totalAct || 1)) * 100;
    const avgCycleTime = globalStats.ctCount > 0 ? (globalStats.totalCycleTime / globalStats.ctCount).toFixed(1) : 0;

    const getSevPct = (val) => globalStats.sev.totalItems > 0 ? ((val / globalStats.sev.totalItems) * 100).toFixed(1) : 0;

    let html = `
    <div style="direction: ltr; text-align: left; font-family: 'Segoe UI', Tahoma, sans-serif; padding: 10px;">
        <h2 style="color: #2c3e50; border-left: 5px solid #3498db; padding-left: 15px; margin-bottom: 25px;">Team-Wide Iteration Insights (Comprehensive)</h2>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px;">
            
            <div style="background: white; border-radius: 12px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border-top: 4px solid ${effortVariance <= 15 ? '#27ae60' : '#e74c3c'};">
                <div style="color: #7f8c8d; font-size: 0.85em; font-weight: bold; margin-bottom: 10px;">EFFORT VARIANCE (FULL)</div>
                <div style="font-size: 2.2em; font-weight: bold; color: ${effortVariance <= 15 ? '#27ae60' : '#e74c3c'};">${effortVariance.toFixed(1)}%</div>
                <div style="font-size: 0.8em; color: #95a5a6; margin-top: 5px;">Includes Core Work + DB + Quality</div>
            </div>

            <div style="background: white; border-radius: 12px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border-top: 4px solid #f39c12;">
                <div style="color: #7f8c8d; font-size: 0.85em; font-weight: bold; margin-bottom: 10px;">REWORK RATIO (TOTAL)</div>
                <div style="font-size: 2.2em; font-weight: bold; color: #e67e22;">${combinedReworkRatio.toFixed(1)}%</div>
                <div style="font-size: 0.8em; color: #95a5a6; margin-top: 5px;">${(globalStats.reworkHrs + globalStats.reviewHrs).toFixed(1)} Quality Hours</div>
            </div>

            <div style="background: white; border-radius: 12px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border-top: 4px solid #3498db;">
                <div style="color: #7f8c8d; font-size: 0.85em; font-weight: bold; margin-bottom: 10px;">AVG CYCLE TIME</div>
                <div style="font-size: 2.2em; font-weight: bold; color: #2980b9;">${avgCycleTime} <span style="font-size: 0.5em;">Days</span></div>
                <div style="font-size: 0.8em; color: #95a5a6; margin-top: 5px;">From Activation to Completion</div>
            </div>
        </div>

        <div style="background: white; border-radius: 12px; padding: 25px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-bottom: 30px;">
            <h4 style="margin: 0 0 20px 0; color: #34495e; font-size: 1.1em;">Defect Severity Distribution (Bugs + Reviews)</h4>
            <div style="display: flex; height: 40px; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">
                <div title="Critical" style="width: ${getSevPct(globalStats.sev.crit)}%; background: #c0392b; display: flex; align-items: center; justify-content: center; color: white; font-size: 0.8em;">${getSevPct(globalStats.sev.crit)}%</div>
                <div title="High" style="width: ${getSevPct(globalStats.sev.high)}%; background: #e67e22; display: flex; align-items: center; justify-content: center; color: white; font-size: 0.8em;">${getSevPct(globalStats.sev.high)}%</div>
                <div title="Medium" style="width: ${getSevPct(globalStats.sev.med)}%; background: #f1c40f; display: flex; align-items: center; justify-content: center; color: #2c3e50; font-size: 0.8em;">${getSevPct(globalStats.sev.med)}%</div>
                <div title="Low" style="width: ${getSevPct(globalStats.sev.low)}%; background: #2ecc71; display: flex; align-items: center; justify-content: center; color: white; font-size: 0.8em;">${getSevPct(globalStats.sev.low)}%</div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; text-align: center;">
                <div><b style="color:#c0392b;">Critical:</b> ${globalStats.sev.crit}</div>
                <div><b style="color:#e67e22;">High:</b> ${globalStats.sev.high}</div>
                <div><b style="color:#f39c12;">Medium:</b> ${globalStats.sev.med}</div>
                <div><b style="color:#27ae60;">Low:</b> ${globalStats.sev.low}</div>
            </div>
        </div>

        <div style="background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); overflow: hidden;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
                <thead style="background: #f8f9fa;">
                    <tr style="text-align: left; border-bottom: 2px solid #edf2f7;">
                        <th style="padding: 15px;">Business Area</th>
                        <th style="padding: 15px;">Stories</th>
                        <th style="padding: 15px;">Est (Core)</th>
                        <th style="padding: 15px;">Act (Total)</th>
                        <th style="padding: 15px;">Effort Var.</th>
                        <th style="padding: 15px;">Rework Ratio</th>
                    </tr>
                </thead>
                <tbody>`;

    const grouped = groupBy(processedStories, 'businessArea');
    for (let area in grouped) {
        const areaStories = grouped[area];
        let a = { est: 0, act: 0, rw: 0, rv: 0 };
        
        areaStories.forEach(s => {
            const sEst = s.devEffort.orig + s.testEffort.orig + (s.dbEffort?.orig || 0);
            const sRv = (s.reviewStats.devActual + s.reviewStats.testActual);
            const sAct = s.devEffort.actual + s.testEffort.actual + (s.dbEffort?.actual || 0) + s.rework.actualTime + sRv;
            a.est += sEst; a.act += sAct; a.rw += s.rework.actualTime; a.rv += sRv;
        });

        const aVar = ((a.act - a.est) / (a.est || 1)) * 100;
        const aRwRatio = ((a.rw + a.rv) / (a.act || 1)) * 100;

        html += `
            <tr style="border-bottom: 1px solid #edf2f7;">
                <td style="padding: 15px; font-weight: 600;">${area}</td>
                <td style="padding: 15px;">${areaStories.length}</td>
                <td style="padding: 15px;">${a.est.toFixed(1)}h</td>
                <td style="padding: 15px;">${a.act.toFixed(1)}h</td>
                <td style="padding: 15px; color: ${aVar > 15 ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${aVar.toFixed(1)}%</td>
                <td style="padding: 15px; color: ${aRwRatio > 15 ? '#e67e22' : '#27ae60'}; font-weight: bold;">${aRwRatio.toFixed(1)}%</td>
            </tr>`;
    }

    html += `</tbody>table</div></div>`;
    container.innerHTML = html;
}

function renderBusinessView() {
    const container = document.getElementById('business-view');
    const grouped = groupBy(processedStories, 'businessArea');
    let html = '<h2>Business Area & User Story Analysis</h2>';
    
    for (let area in grouped) {
        html += `<div class="business-section"><h3 class="business-area-title">${area}</h3>`;
        
        grouped[area].forEach(us => {
            const formatDate = (date) => {
                if (!date || isNaN(new Date(date))) return 'N/A';
                return new Date(date).toLocaleString('en-GB', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
            };

            const devTasksSorted = us.tasks
                .filter(t => t.Activity !== 'Testing')
                .sort((a, b) => new Date(a['Activated Date'] || 0) - new Date(b['Activated Date'] || 0));

            const testingTasksSorted = us.tasks
                .filter(t => t.Activity === 'Testing')
                .sort((a, b) => parseInt(a.id || 0) - parseInt(b.id || 0));

            const sortedTasks = [...devTasksSorted, ...testingTasksSorted];

            const renderSev = (sevObj, total) => {
                if (!total) return 'N/A';
                return `C: ${sevObj.critical} (${((sevObj.critical/total)*100).toFixed(0)}%) | 
                        H: ${sevObj.high} (${((sevObj.high/total)*100).toFixed(0)}%) | 
                        M: ${sevObj.medium} (${((sevObj.medium/total)*100).toFixed(0)}%) |
                        L: ${sevObj.low} (${((sevObj.low/total)*100).toFixed(0)}%)`;
            };

         html += `
<div class="card" style="margin-bottom: 30px; border-left: 5px solid #2980b9; overflow-x: auto;">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
        <h4>ID: ${us.id} - ${us.title}</h4>
        <div style="text-align: right; font-size: 0.85em; color: #2c3e50; background: #f8f9fa; padding: 10px; border-radius: 8px; border: 1px solid #ddd; line-height: 1.6;">
            <div><b style="color: #27ae60;">US Start:</b> ${formatDate(sortedTasks[0]?.expectedStart)}</div>
            <div><b style="color: #3498db;">US Actual End:</b> ${formatDate(us.testedDate)}</div>
            <div style="margin-top:5px; padding-top:5px; border-top:1px solid #eee;">
                <b style="color: #e67e22;">Cycle Time: ${us.cycleTime || 0} Working Days</b>
            </div>
        </div>
    </div>
                    <p>
                        <b>Dev Lead:</b> ${us.devLead} | 
                        <b>Tester Lead:</b> ${us.testerLead} | 
                        <b style="color: #8e44ad;">DB Mod:</b> ${us.dbEffort.names}
                    </p>
    <table style="width:100%; border-collapse:collapse; margin-bottom:15px;">
    <thead>
        <tr>
            <th>Type</th>
            <th>Est. (H)</th>
            <th>Actual (H)</th>
            <th>Bugs / Reviews</th> 
            <th>Bugs Work (H)</th>
            <th>Review Work (H)</th> 
            <th>Effort Variance</th>
        </tr>
    </thead>
    <tbody>
        <tr>
    <td>Dev (Excl. DB)</td>
    <td>${us.devEffort.orig.toFixed(1)}</td>
    <td>${us.devEffort.actual.toFixed(1)}</td>
    
    <td rowspan="3" style="text-align:left; vertical-align:middle; background:#fcfcfc; border: 1px solid #eee; padding: 10px;">
        <div style="margin-bottom: 8px;">
            <b style="color:#c0392b; font-size:0.9em;">🐞 Specific Bugs: ${us.rework.specific.count}</b>
            <div style="font-size: 0.7em; color: #666;">${renderSev(us.rework.specific.severity, us.rework.specific.count)}</div>
        </div>
        <div style="margin-bottom: 8px; padding-top: 5px; border-top: 1px solid #eee;">
            <b style="color:#e67e22; font-size:0.9em;">⚙️ Generic Bugs: ${us.rework.generic.count}</b>
            <div style="font-size: 0.7em; color: #666;">${renderSev(us.rework.generic.severity, us.rework.generic.count)}</div>
        </div>
        <div style="padding-top: 5px; border-top: 1px solid #eee;">
            <b style="color:#8e44ad; font-size:0.9em;">🔎 Reviews: ${us.reviewStats.count}</b>
            <div style="font-size: 0.7em; color: #666;">${renderSev(us.reviewStats.severity, us.reviewStats.count)}</div>
        </div>
    </td>

    <td rowspan="3" style="text-align:center; vertical-align:middle; background:#fff5f5;">
        <div title="Specific Bug Hours" style="color:#c0392b; font-size:0.85em;">Spec: <b>${us.rework.specific.actualTime.toFixed(1)}h</b></div>
        <div title="Generic Bug Hours" style="color:#e67e22; font-size:0.85em; margin-top:5px; border-top: 1px dashed #ffcdd2;">Gen: <b>${us.rework.generic.actualTime.toFixed(1)}h</b></div>
        <div style="margin-top:5px; font-weight:bold; border-top: 1px solid #ffcdd2;">Total: ${(us.rework.actualTime).toFixed(1)}h</div>
    </td>

    <td rowspan="3" style="text-align:center; vertical-align:middle; background:#f5f3ff;">
        <div style="color:#6d28d9; font-size:0.85em;">Dev: <b>${us.reviewStats.devActual.toFixed(1)}h</b></div>
        <div style="color:#2980b9; font-size:0.85em; margin-top:5px;">Test: <b>${us.reviewStats.testActual.toFixed(1)}h</b></div>
    </td>
    
    <td class="${us.devEffort.dev < 0.85 ? 'alert-red' : ''}"><b>${us.devEffort.dev.toFixed(2)}</b></td>
    </tr>
        <tr style="background: #f4ecf7;">
            <td>DB Modification</td>
            <td>${us.dbEffort.orig.toFixed(1)}</td>
            <td>${us.dbEffort.actual.toFixed(1)}</td>
            <td class="${us.dbEffort.dev < 0.85 ? 'alert-red' : ''}"><b>${us.dbEffort.dev.toFixed(2)}</b></td>
        </tr>
        <tr>
            <td>Test</td>
            <td>${us.testEffort.orig.toFixed(1)}</td>
            <td>${us.testEffort.actual.toFixed(1)}</td>
            <td class="${us.testEffort.dev < 0.85 ? 'alert-red' : ''}"><b>${us.testEffort.dev.toFixed(2)}</b></td>
        </tr>
    </tbody>
</table>



                    <h5 style="margin: 20px 0 10px 0; color: #2c3e50;">Tasks Timeline & Schedule:</h5>
                    <table style="font-size: 0.85em; width: 100%;">
                        <thead>
                            <tr style="background:#eee;">
                                <th>ID</th>
                                <th>Task Name</th>
                                <th>Activity</th>
                                <th>Est</th>
                                <th>Exp. Start</th>
                                <th>Exp. End</th>
                                <th>Act. Start</th>
                                <th>Act. End</th> 
                                <th>TS Total</th>
                                <th>Delay</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sortedTasks.map(t => {
                                const tsTotal = (parseFloat(t['TimeSheet_DevActualTime']) || 0) + (parseFloat(t['TimeSheet_TestingActualTime']) || 0);
                                const est = parseFloat(t['Original Estimation']) || 0;
                                const actualEnd = t['Actual End'] || t['Resolved Date'];
                                return `
                                <tr>
                                    <td>${t['ID']}</td>
                                    <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${t['Title']}">${t['Title'] || 'N/A'}</td>
                                    <td>${t['Activity']}</td>
                                    <td>${est}</td>
                                    <td style="background-color: #e8f4fd; font-weight: 500;">${formatDate(t.expectedStart)}</td>
                                    <td>${formatDate(t.expectedEnd)}</td>
                                    <td style="background-color: #eafaf1; font-weight: 500;">${formatDate(t['Activated Date'])}</td>
                                    <td>${formatDate(actualEnd)}</td> 
                                    <td>${tsTotal}</td>
                                    <td class="${calculateHourDiff(t.expectedStart, t['Activated Date']) > 0 ? 'alert-red' : ''}">
                                        ${calculateHourDiff(t.expectedStart, t['Activated Date'])}h
                                    </td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>`;

            html += `
                <div style="background: #fdfdfd; padding: 15px; border-radius: 8px; margin-top: 15px; border: 1px solid #eee; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <h5 style="margin: 0; color: #2c3e50;">Quality & Review Analysis</h5>
                        <div style="display: flex; gap: 10px;">
                            <span style="background: #f5f3ff; color: #5b21b6; padding: 4px 10px; border-radius: 20px; font-size: 0.8em; font-weight: bold; border: 1px solid #ddd;">
                                🔎 Review Actual: Dev ${us.reviewStats.devActual.toFixed(1)}h | Test ${us.reviewStats.testActual.toFixed(1)}h
                            </span>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 20px; align-items: center;">
                        <div style="flex: 1;">
                            <div style="display: flex; justify-content: space-between; font-size: 0.85em; margin-bottom: 5px;">
                                <span>Quality Ratio: <b>${(( (us.rework.actualTime + us.reviewStats.totalActual) / (us.devEffort.actual || 1)) * 100).toFixed(1)}%</b></span>
                            </div>
                            <div style="width: 100%; background: #eee; height: 10px; border-radius: 5px; overflow: hidden; display: flex;">
                                <div style="width: ${Math.min((us.rework.actualTime / (us.devEffort.actual || 1) * 100), 100)}%; background: #e74c3c;" title="Standard Bugs"></div>
                                <div style="width: ${Math.min((us.reviewStats.devActual / (us.devEffort.actual || 1) * 100), 100)}%; background: #8e44ad;" title="Dev Review"></div>
                                <div style="width: ${Math.min((us.reviewStats.testActual / (us.devEffort.actual || 1) * 100), 100)}%; background: #3498db;" title="Test Review"></div>
                            </div>
                        </div>
                    </div>
                </div></div>`; 
        });
        html += `</div>`;
    }
    container.innerHTML = html;
}

function renderTeamView() {
    const container = document.getElementById('team-view');
    if (!processedStories || processedStories.length === 0) {
        container.innerHTML = "<div class='card'><h2>Team Performance</h2><p>No data available.</p></div>";
        return;
    }
    const grouped = groupBy(processedStories, 'businessArea');

    let devParticipation = {};
    let testerParticipation = {};
    let dbParticipation = {};
    let areaDevs = {};
    let areaTesters = {};
    let areaDbs = {};

    for (let area in grouped) {
        areaDevs[area] = new Set();
        areaTesters[area] = new Set();
        areaDbs[area] = new Set();
        grouped[area].forEach(us => {
            if (us.devLead) areaDevs[area].add(us.devLead);
            if (us.testerLead) areaTesters[area].add(us.testerLead);
            if (us.tasks) {
                us.tasks.forEach(t => {
                    if (t['Activity'] === 'DB Modification' && t['Assigned To']) {
                        areaDbs[area].add(t['Assigned To']);
                    }
                });
            }
        });
        areaDevs[area].forEach(d => {
            devParticipation[d] = (devParticipation[d] || 0) + 1;
        });
        areaTesters[area].forEach(t => {
            testerParticipation[t] = (testerParticipation[t] || 0) + 1;
        });
        areaDbs[area].forEach(db => {
            dbParticipation[db] = (dbParticipation[db] || 0) + 1;
        });
    }

    let html = `
    <div style="direction: ltr; text-align: left; font-family: 'Segoe UI', Tahoma, sans-serif; padding: 20px;">
        <h2 style="margin-bottom:30px; color: #2c3e50; border-left: 6px solid #2ecc71; padding-left: 20px; font-size: 1.8em;"> 
            🚀 Team Performance Analytics (Unified QC & Review Scope) 
        </h2>`;

    for (let area in grouped) {
        let stats = {
            totalEst: 0,
            totalAct: 0,
            reworkTime: 0,
            reviewTime: 0,
            bugsCount: 0,
            bugsCrit: 0,
            bugsHigh: 0,
            bugsMed: 0,
            bugsLow: 0,
            reviewCount: 0,
            revCrit: 0,
            revHigh: 0,
            revMed: 0,
            revLow: 0,
            totalStories: grouped[area].length,
            closedStoriesCount: 0,
            totalCycleTime: 0,
            totalUatBugs: 0,
            totalIterationBugs: 0,
            // --- NEW fields for enhanced analysis ---
            genericBugCount: 0,
            specificBugCount: 0,
            bugDistributionByDev: {},
            bugDistributionByStory: {},
            bugSeverityByStory: {},
            bugTitles: [],
            bugCategories: [],
            reviewTitles: [],
            reviewActivities: [],
            reviewCategories: [],
            maxCycleTime: 0,
            maxCycleTimeStoryId: null,
            maxCycleTimeStoryEst: 0,
            maxCycleTimeStoryRework: 0
        };

        let devCountCount = 0;
        areaDevs[area].forEach(d => {
            if(devParticipation[d]) devCountCount += (1 / devParticipation[d]);
        });
        let testerCountCount = 0;
        areaTesters[area].forEach(t => {
            if(testerParticipation[t]) testerCountCount += (1 / testerParticipation[t]);
        });
        let dbCountCount = 0;
        areaDbs[area].forEach(db => {
            if(dbParticipation[db]) dbCountCount += (1 / dbParticipation[db]);
        });
        // Store for use in insights
        stats.devCountCount = devCountCount;
        stats.testerCountCount = testerCountCount;
        stats.dbCountCount = dbCountCount;

        grouped[area].forEach(us => {
            const sEst = us.devEffort.orig + us.testEffort.orig + (us.dbEffort?.orig || 0);
            const sRvTime = us.reviewStats.devActual + us.reviewStats.testActual;
            const sAct = us.devEffort.actual + us.testEffort.actual + (us.dbEffort?.actual || 0) + us.rework.actualTime + sRvTime;
            
            stats.totalEst += sEst;
            stats.totalAct += sAct;
            stats.reworkTime += us.rework.actualTime;
            stats.reviewTime += sRvTime;
            stats.totalCycleTime += (us.cycleTime || 0);
            stats.bugsCount += us.rework.count;
            stats.bugsCrit += us.rework.severity.critical;
            stats.bugsHigh += us.rework.severity.high;
            stats.bugsMed += us.rework.severity.medium;
            stats.bugsLow += us.rework.severity.low;
            stats.reviewCount += us.reviewStats.count;
            stats.revCrit += us.reviewStats.severity.critical;
            stats.revHigh += us.reviewStats.severity.high;
            stats.revMed += us.reviewStats.severity.medium;
            stats.revLow += us.reviewStats.severity.low;

            stats.totalUatBugs += (us.rework.uatBugsCount || 0);
            stats.totalIterationBugs += (us.rework.iterationBugsCount || 0);

            // --- NEW: Aggregation of additional metrics ---
            // Generic vs Specific
            stats.genericBugCount += (us.rework.generic ? us.rework.generic.count : 0);
            stats.specificBugCount += (us.rework.specific ? us.rework.specific.count : 0);

            // Bug distribution by Developer
            const dev = us.devLead || 'Unassigned';
            stats.bugDistributionByDev[dev] = (stats.bugDistributionByDev[dev] || 0) + us.bugs.length;

            // Bug distribution by Story (ID)
            const storyId = us.id || 'Unknown';
            stats.bugDistributionByStory[storyId] = (stats.bugDistributionByStory[storyId] || 0) + us.bugs.length;

            // Bug severity by Story
            if (!stats.bugSeverityByStory[storyId]) {
                stats.bugSeverityByStory[storyId] = { critical: 0, high: 0, medium: 0, low: 0 };
            }
            us.bugs.forEach(b => {
                const sev = b['Severity'] || '';
                if (sev.includes('1 - Critical')) stats.bugSeverityByStory[storyId].critical++;
                else if (sev.includes('2 - High')) stats.bugSeverityByStory[storyId].high++;
                else if (sev.includes('3 - Medium')) stats.bugSeverityByStory[storyId].medium++;
                else if (sev.includes('4 - Low')) stats.bugSeverityByStory[storyId].low++;
            });

            // Collect titles and categories for bugs and reviews
            if (us.bugTitles) {
                stats.bugTitles = stats.bugTitles.concat(us.bugTitles);
                stats.bugCategories = stats.bugCategories.concat(us.bugCategories || []);
            }
            if (us.reviewTitles) {
                stats.reviewTitles = stats.reviewTitles.concat(us.reviewTitles);
                stats.reviewActivities = stats.reviewActivities.concat(us.reviewActivities || []);
                stats.reviewCategories = stats.reviewCategories.concat(us.reviewCategories || []);
            }
                   // --- NEW: Track highest cycle time story ---
const storyTotalEst = us.devEffort.orig + us.testEffort.orig + (us.dbEffort?.orig || 0);
const storyReviewTime = us.reviewStats.devActual + us.reviewStats.testActual;
const storyTotalAct = us.devEffort.actual + us.testEffort.actual + (us.dbEffort?.actual || 0) + us.rework.actualTime + storyReviewTime;

if (us.cycleTime > (stats.maxCycleTime || 0)) {
    stats.maxCycleTime = us.cycleTime;
    stats.maxCycleTimeStoryId = us.id || 'Unknown';
    stats.maxCycleTimeStoryEst = storyTotalEst;
    stats.maxCycleTimeStoryRework = us.rework.actualTime || 0;
    // NEW: Store cycle hours using 5-hour workday
    stats.maxCycleTimeStoryHours = us.cycleTime * 5;
}
// --- END NEW ---

            if (us.status === 'Closed' || us.status === 'Tested' || us.status === 'Resolved' || us.status === 'To Be Reviewed') {
                stats.closedStoriesCount++;
            }
        });

        const effortVariance = stats.totalEst > 0 ? ((stats.totalAct - stats.totalEst) / stats.totalEst) * 100 : 0;
        const combinedReworkRatio = ((stats.reworkTime + stats.reviewTime) / (stats.totalAct || 1)) * 100;
        const avgCycleTime = (stats.totalCycleTime / stats.totalStories).toFixed(1);

        // ======================= THRESHOLDS LOGIC =======================
        let thresholdDays = null;
        let areaLower = area.toLowerCase();
        if (areaLower.includes('registration') || areaLower.includes('internal lab')) {
            thresholdDays = 18;
        } else if (areaLower.includes('front') || areaLower.includes('financial')) {
            thresholdDays = 9;
        }
        let isExceeded = false;
        let thresholdMsg = '';
        if (thresholdDays !== null && parseFloat(avgCycleTime) > thresholdDays) {
            isExceeded = true;
            thresholdMsg = `⚠️ Exceeds threshold (${thresholdDays}d max)`;
        } else if (thresholdDays !== null) {
            thresholdMsg = `✅ Within threshold (≤${thresholdDays}d)`;
        }
        // ================================================================

        const totalAllBugs = stats.bugsCount + stats.totalUatBugs;
        const dreValueNum = totalAllBugs > 0 ? (stats.bugsCount / totalAllBugs) * 100 : 100;
        const dreValue = dreValueNum.toFixed(1);
        
        const dreColor = dreValueNum >= 85 ? '#2e7d32' : '#d32f2f';
        const varianceColor = effortVariance <= 15 ? '#2e7d32' : '#d32f2f';
        const reworkColor = combinedReworkRatio > 15 ? '#d32f2f' : '#2e7d32';

        const getSevBadges = (c, h, m, l, t) => {
            if (!t) return '<div style="color:#7f8c8d; margin-top:5px; font-size:0.85em; font-style:italic;">No records found</div>';
            const pct = (v) => ((v / t) * 100).toFixed(0);
            const badgeStyle = (bg, color, border) => `background:${bg}; color:${color}; padding:8px 4px; border-radius:6px; text-align:center; flex:1; border:1px solid ${border}; display: flex; flex-direction: column; justify-content: center; min-width:65px;`;
            return `
             <div style="display: flex; gap: 6px; margin-top: 10px;">
                <div style="${badgeStyle('#ffeaed', '#c0392b', '#ffcdd2')}"><span style="font-size:10px; font-weight:600;">Critical</span><b style="font-size:14px; margin-top:2px;">${c}</b><span style="font-size:9px; opacity:0.8;">${pct(c)}%</span></div>
                <div style="${badgeStyle('#fff3e0', '#e67e22', '#ffe0b2')}"><span style="font-size:10px; font-weight:600;">High</span><b style="font-size:14px; margin-top:2px;">${h}</b><span style="font-size:9px; opacity:0.8;">${pct(h)}%</span></div>
                <div style="${badgeStyle('#e8f4fd', '#2980b9', '#bbdefb')}"><span style="font-size:10px; font-weight:600;">Medium</span><b style="font-size:14px; margin-top:2px;">${m}</b><span style="font-size:9px; opacity:0.8;">${pct(m)}%</span></div>
                <div style="${badgeStyle('#f5f5f5', '#7f8c8d', '#e0e0e0')}"><span style="font-size:10px; font-weight:600;">Low</span><b style="font-size:14px; margin-top:2px;">${l}</b><span style="font-size:9px; opacity:0.8;">${pct(l)}%</span></div>
             </div>`;
        };

        html += `
        <div class="card" style="background:#ffffff; border-radius:12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); padding:25px; margin-bottom:35px; border-top: 4px solid #2ccc71;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #f1f2f6; padding-bottom:15px; margin-bottom:20px;">
                <h3 style="margin:0; color:#2c3e50; font-size:1.4em; font-weight:700;">📂 Business Area: ${area}</h3>
                <span style="background:#f1f2f6; color:#2c3e50; padding:6px 14px; border-radius:20px; font-size:0.85em; font-weight:600;">
                    📊 Stories: <b>${stats.closedStoriesCount} / ${stats.totalStories} Closed</b>
                </span>
            </div>

            <div style="display:flex; gap:15px; margin-bottom:25px; background:#f8f9fa; padding:12px; border-radius:8px; font-size:0.9em; color:#57606f; border:1px solid #edeec4;">
                <span>👥 <b>FTE Dev Capacity:</b> ${devCountCount.toFixed(2)}</span> | 
                <span>🧪 <b>FTE Tester Capacity:</b> ${testerCountCount.toFixed(2)}</span> | 
                <span>🗄️ <b>FTE DB Capacity:</b> ${dbCountCount.toFixed(2)}</span>
            </div>

            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:20px; margin-bottom:30px;">
                
                <div style="background:#fafafa; border-radius:10px; padding:20px; border-left:4px solid ${varianceColor}; box-shadow:0 2px 5px rgba(0,0,0,0.02);">
                    <div style="font-size:0.85em; color:#747d8c; text-transform:uppercase; font-weight:600;">Effort Variance</div>
                    <div style="font-size:1.8em; font-weight:700; color:${varianceColor}; margin:5px 0;">${effortVariance.toFixed(1)}%</div>
                    <div style="font-size:0.8em; color:#57606f;">Est: <b>${stats.totalEst.toFixed(1)}h</b> | Act: <b>${stats.totalAct.toFixed(1)}h</b></div>
                </div>

                <div style="background:#fafafa; border-radius:10px; padding:20px; border-left:4px solid ${reworkColor}; box-shadow:0 2px 5px rgba(0,0,0,0.02);">
                    <div style="font-size:0.85em; color:#747d8c; text-transform:uppercase; font-weight:600;">Rework & Review Ratio</div>
                    <div style="font-size:1.8em; font-weight:700; color:${reworkColor}; margin:5px 0;">${combinedReworkRatio.toFixed(1)}%</div>
                    <div style="font-size:0.8em; color:#57606f;">Bugs: <b>${stats.reworkTime.toFixed(1)}h</b> | Revs: <b>${stats.reviewTime.toFixed(1)}h</b></div>
                </div>

                <div style="background:#fafafa; border-radius:10px; padding:20px; border-left:4px solid ${dreColor}; box-shadow:0 2px 5px rgba(0,0,0,0.02);">
                    <div style="font-size:0.85em; color:#747d8c; text-transform:uppercase; font-weight:600;">DRE</div>
                    <div style="font-size:1.8em; font-weight:700; color:${dreColor}; margin:5px 0;">${dreValue}%</div>
                    <div style="font-size:0.8em; color:#57606f;">UAT: <b>${stats.totalUatBugs}</b> / Iteration: <b>${stats.bugsCount}</b></div>
                </div>

                <div style="background:#fafafa; border-radius:10px; padding:20px; border-left:4px solid ${isExceeded ? '#e74c3c' : '#8e44ad'}; box-shadow:0 2px 5px rgba(0,0,0,0.02);">
                    <div style="font-size:0.85em; color:#747d8c; text-transform:uppercase; font-weight:600;">Avg Cycle Time</div>
                    <div style="font-size:1.8em; font-weight:700; color:${isExceeded ? '#c0392b' : '#8e44ad'}; margin:5px 0;">${avgCycleTime} Days</div>
                    <div style="font-size:0.75em; margin-top:6px; color:${isExceeded ? '#e74c3c' : '#2e7d32'};">
                        ${thresholdMsg}
                    </div>
                    <div style="font-size:0.8em; color:#57606f;">Total Net Days: <b>${stats.totalCycleTime}</b></div>
                </div>

            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:25px; margin-bottom:20px;">
                <div style="background:#fff; border:1px solid #eaeed8; border-radius:10px; padding:18px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; font-weight:600; color:#2c3e50; border-bottom:1px solid #f1f2f6; padding-bottom:8px;">
                        <span>🐞 Execution Bugs Detail</span>
                        <span style="background:#ffebee; color:#c62828; font-size:0.8em; padding:2px 8px; border-radius:10px;">Count: ${stats.bugsCount}</span>
                    </div>
                    ${getSevBadges(stats.bugsCrit, stats.bugsHigh, stats.bugsMed, stats.bugsLow, stats.bugsCount)}
                </div>

                <div style="background:#fff; border:1px solid #eaeed8; border-radius:10px; padding:18px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; font-weight:600; color:#2c3e50; border-bottom:1px solid #f1f2f6; padding-bottom:8px;">
                        <span>🔎 Shift-Left Reviews Detail</span>
                        <span style="background:#f3e5f5; color:#6a1b9a; font-size:0.8em; padding:2px 8px; border-radius:10px;">Count: ${stats.reviewCount}</span>
                    </div>
                    ${getSevBadges(stats.revCrit, stats.revHigh, stats.revMed, stats.revLow, stats.reviewCount)}
                </div>
            </div>

            <div style="margin-top:25px; background:#f9f9fb; border-radius:8px; padding:20px; border:1px solid #eccc68; box-shadow:inset 0 1px 3px rgba(0,0,0,0.02);">
                <h4 style="margin:0 0 12px 0; color:#ffa502; font-size:1.05em; font-weight:700; display:flex; align-items:center; gap:8px;">
                    🧠 Defect Analyses
                </h4>
                <ul style="margin:0; padding-left:20px; font-size:0.92em; color:#2c3e50; line-height:1.6;">
                    ${generateAdvancedQualityAnalysis(stats)}
                </ul>
            </div>

        </div>`;
    }

    html += `</div>`;
    container.innerHTML = html;
}

function generateAdvancedQualityAnalysis(s) {
    let insights = [];

    // ========== Existing calculations (kept) ==========
    const totalIssues = s.bugsCount + s.reviewCount;
    const reviewCatchRate = totalIssues > 0 ? (s.reviewCount / totalIssues) * 100 : 0;
    const highSevBugs = s.bugsCrit + s.bugsHigh;
    const highSevReviews = s.revCrit + s.revHigh;
    const avgTimePerBug = s.bugsCount > 0 ? (s.reworkTime / s.bugsCount) : 0;
    const effortVariance = s.totalEst > 0 ? ((s.totalAct - s.totalEst) / s.totalEst) * 100 : 0;
    const combinedReworkRatio = ((s.reworkTime + s.reviewTime) / (s.totalAct || 1)) * 100;
    const avgCycleTime = s.totalStories > 0 ? (s.totalCycleTime / s.totalStories) : 0;
    const totalAllBugsLocal = s.bugsCount + (s.totalUatBugs || 0);
    const calculatedDre = totalAllBugsLocal > 0 ? (s.bugsCount / totalAllBugsLocal) * 100 : 100;
    const bugSeverityRatio = s.bugsCount > 0 ? (highSevBugs / s.bugsCount) * 100 : 0;
    const reviewSeverityRatio = s.reviewCount > 0 ? (highSevReviews / s.reviewCount) * 100 : 0;
    const uatLeakageRatio = totalAllBugsLocal > 0 ? ((s.totalUatBugs || 0) / totalAllBugsLocal) * 100 : 0;

    // Helper to create a tooltip icon with explanation
    const infoIcon = (text) => `<span style="cursor:help; font-size:0.8em; color:#888; margin-left:4px;" title="${text}">ⓘ</span>`;

    // ========== Existing insights (kept, with tooltips) ==========
    // 1. Shift-Left
    const shiftLeftExplanation = `Reviews / (Bugs + Reviews) * 100 = ${s.reviewCount} / ${totalIssues} * 100 = ${reviewCatchRate.toFixed(1)}%`;
    insights.push(`<li><b>Shift-Left Strategy Efficiency</b> ${infoIcon(shiftLeftExplanation)}: Peer Reviews intercepted ${reviewCatchRate.toFixed(1)}% of total issues (${s.reviewCount} reviews out of ${totalIssues} total issues).</li>`);

    // 2. Effort & Rework Correlations
    if (effortVariance > 15 && combinedReworkRatio > 15) {
        const explanation = `Effort Variance = (Actual - Estimate)/Estimate * 100 = ${((s.totalAct - s.totalEst) / s.totalEst * 100).toFixed(1)}%, Rework Ratio = (ReworkTime+ReviewTime)/Actual * 100 = ${combinedReworkRatio.toFixed(1)}%`;
        insights.push(`<li><b>Rework-Driven Slippage</b> ${infoIcon(explanation)}: Effort Variance is ${effortVariance.toFixed(1)}% and Rework Ratio is ${combinedReworkRatio.toFixed(1)}%.</li>`);
    } else if (effortVariance > 15 && combinedReworkRatio <= 15) {
        const explanation = `Effort Variance = ${effortVariance.toFixed(1)}% (Actual ${s.totalAct.toFixed(1)}h vs Estimate ${s.totalEst.toFixed(1)}h), Rework/Review = ${combinedReworkRatio.toFixed(1)}%`;
        insights.push(`<li><b>Estimation Model Baseline Flaw</b> ${infoIcon(explanation)}: Effort Variance is ${effortVariance.toFixed(1)}% while Rework/Review metrics are ${combinedReworkRatio.toFixed(1)}%.</li>`);
    } else if (effortVariance <= 0 && combinedReworkRatio > 20) {
        const explanation = `Effort Variance = ${effortVariance.toFixed(1)}% (under budget), Rework Density = ${combinedReworkRatio.toFixed(1)}%`;
        insights.push(`<li><b>Aggressive Coding & Velocity Risk</b> ${infoIcon(explanation)}: Effort Variance is ${effortVariance.toFixed(1)}% and Rework Density is ${combinedReworkRatio.toFixed(1)}%.</li>`);
    }

    // 3. DRE & UAT Leakage
    if (calculatedDre < 85 && (s.totalUatBugs || 0) > 0) {
        const explanation = `DRE = Bugs / (Bugs+UAT) * 100 = ${s.bugsCount} / ${totalAllBugsLocal} * 100 = ${calculatedDre.toFixed(1)}%, UAT Leakages = ${s.totalUatBugs}`;
        insights.push(`<li><b>Degraded Quality Shield (Low DRE)</b> ${infoIcon(explanation)}: DRE is ${calculatedDre.toFixed(1)}% with ${s.totalUatBugs} UAT Leakages out of ${totalAllBugsLocal} total defects.</li>`);
    }

    // 4. Bug Severity
    if (s.bugsCount > 0) {
        if (bugSeverityRatio > 30) {
            const explanation = `High/Critical Bugs / Total Bugs * 100 = ${highSevBugs} / ${s.bugsCount} * 100 = ${bugSeverityRatio.toFixed(1)}%`;
            insights.push(`<li><b>Defect Severity Alert</b> ${infoIcon(explanation)}: High/Critical bugs constitute ${bugSeverityRatio.toFixed(1)}% of total bugs (${highSevBugs} out of ${s.bugsCount} bugs).</li>`);
            if (highSevReviews === 0) {
                insights.push(`<li><b>Review Blind Spot Diagnosis</b> ${infoIcon('High/Critical bugs detected by Testing = ' + highSevBugs + ', by Reviews = 0')}: Testing detected ${highSevBugs} High/Critical bugs, while Peer Reviews detected 0.</li>`);
            }
        } else {
            const explanation = `High/Critical Bugs / Total Bugs * 100 = ${bugSeverityRatio.toFixed(1)}%`;
            insights.push(`<li><b>Defect Profile Stability</b> ${infoIcon(explanation)}: High-severity bugs are ${bugSeverityRatio.toFixed(1)}% of total bugs.</li>`);
        }
    }

    // 5. MTTR & Cycle Time
    if (avgTimePerBug > 4 && s.bugsCount > 0) {
        const explanation = `MTTR = ReworkTime / Bugs = ${s.reworkTime.toFixed(1)}h / ${s.bugsCount} = ${avgTimePerBug.toFixed(1)}h/bug`;
        insights.push(`<li><b>Rework Friction</b> ${infoIcon(explanation)}: Mean Time to Resolve (MTTR) is ${avgTimePerBug.toFixed(1)}h/bug (total rework ${s.reworkTime.toFixed(1)}h / ${s.bugsCount} bugs).</li>`);
        if (avgCycleTime > 5) {
            const explanation2 = `Cycle Time = ${avgCycleTime.toFixed(1)} days, MTTR = ${avgTimePerBug.toFixed(1)}h/bug`;
            insights.push(`<li><b>Blocked Cycle Time Correlation</b> ${infoIcon(explanation2)}: Cycle Time is ${avgCycleTime.toFixed(1)} days, MTTR is ${avgTimePerBug.toFixed(1)}h.</li>`);
        }
    }

    // 6. Review vs Testing Severity
    if (reviewSeverityRatio > 40 && bugSeverityRatio < 15 && s.reviewCount > 0) {
        const explanation = `High-Sev Review = ${reviewSeverityRatio.toFixed(1)}% (${highSevReviews} reviews), High-Sev Testing = ${bugSeverityRatio.toFixed(1)}%`;
        insights.push(`<li><b>High-Fidelity Pre-Emptive Review</b> ${infoIcon(explanation)}: High-Sev Review is ${reviewSeverityRatio.toFixed(1)}%, High-Sev Testing Bugs is ${bugSeverityRatio.toFixed(1)}%.</li>`);
    }

    if (s.reviewCount > 10 && highSevReviews === 0 && bugSeverityRatio > 40) {
        const explanation = `Reviews = ${s.reviewCount}, High-Sev Reviews = 0, Testing High-Sev = ${bugSeverityRatio.toFixed(1)}%`;
        insights.push(`<li><b>Superficial Peer-Review Pattern</b> ${infoIcon(explanation)}: ${s.reviewCount} Peer Reviews, 0 high-sev issues detected, while Testing high-sev is ${bugSeverityRatio.toFixed(1)}%.</li>`);
    }

    // 7. Hidden Rework
    if (effortVariance > 25 && combinedReworkRatio < 5 && s.bugsCount > 0) {
        const explanation = `Effort Variance = ${effortVariance.toFixed(1)}%, logged Rework/Review = ${combinedReworkRatio.toFixed(1)}%`;
        insights.push(`<li><b>Hidden Rework & Timesheet Inaccuracy</b> ${infoIcon(explanation)}: Effort Variance is ${effortVariance.toFixed(1)}%, logged Rework/Review is ${combinedReworkRatio.toFixed(1)}%.</li>`);
    }

    // 8. Architectural Coupling
    if (s.bugsCount > 0 && s.bugsCount <= 3 && avgTimePerBug > 8) {
        const explanation = `Bugs = ${s.bugsCount}, MTTR = ${avgTimePerBug.toFixed(1)}h`;
        insights.push(`<li><b>Severe Architectural Coupling</b> ${infoIcon(explanation)}: ${s.bugsCount} bugs, MTTR is ${avgTimePerBug.toFixed(1)}h.</li>`);
    }

    // 9. Quality Gate Escape
    if (uatLeakageRatio > 25 && s.bugsCount > 0) {
        const explanation = `UAT Leakages / Total Defects * 100 = ${s.totalUatBugs} / ${totalAllBugsLocal} * 100 = ${uatLeakageRatio.toFixed(1)}%`;
        insights.push(`<li><b>Severe Quality Gate Escape</b> ${infoIcon(explanation)}: UAT Leakages are ${uatLeakageRatio.toFixed(1)}% of total defects (${s.totalUatBugs} UAT / ${totalAllBugsLocal} total).</li>`);
    }

    // 10. Resource Skew
    if (s.devCountCount > 0 && s.testerCountCount > 0) {
        const devToTesterRatio = s.devCountCount / s.testerCountCount;
        if (devToTesterRatio > 3 && s.totalUatBugs > 2) {
            const explanation = `Dev FTE = ${s.devCountCount.toFixed(2)}, Tester FTE = ${s.testerCountCount.toFixed(2)}, Ratio = ${devToTesterRatio.toFixed(1)}:1, UAT = ${s.totalUatBugs}`;
            insights.push(`<li><b>Resource Skew & Test Bottleneck</b> ${infoIcon(explanation)}: Dev-to-Tester ratio is ${devToTesterRatio.toFixed(1)}:1, UAT bugs is ${s.totalUatBugs}.</li>`);
        }
    }

    // ========== Existing statistical insights (with tooltips) ==========

    // 11. Generic vs Specific Bugs
    const genericCount = s.genericBugCount || 0;
    const specificCount = s.specificBugCount || 0;
    const totalBugsGenSpec = genericCount + specificCount;
    if (totalBugsGenSpec > 0) {
        const genericRatio = (genericCount / totalBugsGenSpec) * 100;
        const specificRatio = (specificCount / totalBugsGenSpec) * 100;
        const explanation = `Generic = ${genericCount} (${genericRatio.toFixed(1)}%), Specific = ${specificCount} (${specificRatio.toFixed(1)}%)`;
        insights.push(`<li><b>Generic vs Specific Bugs</b> ${infoIcon(explanation)}: Generic: ${genericCount} (${genericRatio.toFixed(1)}%), Specific: ${specificCount} (${specificRatio.toFixed(1)}%).</li>`);
    }

    // 12. Repeated Bug Titles
    if (s.bugTitles && s.bugTitles.length > 0) {
        const titleFreq = {};
        s.bugTitles.forEach(title => {
            const key = title.trim().toLowerCase();
            titleFreq[key] = (titleFreq[key] || 0) + 1;
        });
        const duplicates = Object.keys(titleFreq).filter(key => titleFreq[key] > 1);
        if (duplicates.length > 0) {
            const dupSummary = duplicates.slice(0, 3).map(key => `"${key}" (${titleFreq[key]}x)`).join(', ');
            const explanation = `Total titles = ${s.bugTitles.length}, duplicates = ${duplicates.length}`;
            insights.push(`<li><b>Repeated Bug Titles</b> ${infoIcon(explanation)}: ${duplicates.length} duplicate titles found. Top repeats: ${dupSummary}.</li>`);
        }
    }

    // 13. Bug Categories
    if (s.bugCategories && s.bugCategories.length > 0) {
        const categoryCount = {};
        s.bugCategories.forEach(cat => {
            categoryCount[cat] = (categoryCount[cat] || 0) + 1;
        });
        const total = s.bugCategories.length;
        let categoriesStr = '';
        for (let cat in categoryCount) {
            const pct = ((categoryCount[cat] / total) * 100).toFixed(1);
            categoriesStr += `${cat}: ${pct}%, `;
        }
        if (categoriesStr.length > 0) {
            categoriesStr = categoriesStr.slice(0, -2);
            const explanation = `Based on ${total} bug titles, classified by keywords (UI, DB, Performance, Logic, Other)`;
            insights.push(`<li><b>Bug Categories</b> ${infoIcon(explanation)}: ${categoriesStr} (based on ${total} bugs).</li>`);
        }
    }

    // 14. High-Severity MTTR
    const highSevCount = s.bugsCrit + s.bugsHigh;
    if (highSevCount > 0 && s.reworkTime > 0) {
        const avgTimePerHighBug = s.reworkTime / highSevCount;
        const explanation = `Total rework time = ${s.reworkTime.toFixed(1)}h, High-sev bugs = ${highSevCount}, Avg = ${avgTimePerHighBug.toFixed(1)}h`;
        insights.push(`<li><b>High-Severity MTTR</b> ${infoIcon(explanation)}: Average resolution time for Critical/High bugs is ${avgTimePerHighBug.toFixed(1)}h (total rework ${s.reworkTime.toFixed(1)}h / ${highSevCount} high-sev bugs).</li>`);
    }

    // ========== Story-level bug concentration ==========

    // 15. User Story with Highest Total Bugs
    if (s.bugDistributionByStory) {
        const storyIds = Object.keys(s.bugDistributionByStory);
        if (storyIds.length > 0) {
            let maxStory = null;
            let maxCount = 0;
            let totalBugsAllStories = 0;
            for (let id in s.bugDistributionByStory) {
                const count = s.bugDistributionByStory[id];
                totalBugsAllStories += count;
                if (count > maxCount) {
                    maxCount = count;
                    maxStory = id;
                }
            }
            if (maxStory && maxCount > 0) {
                const percentage = ((maxCount / totalBugsAllStories) * 100).toFixed(1);
                const explanation = `Total bugs across all stories = ${totalBugsAllStories}, Story '${maxStory}' has ${maxCount} bugs (${percentage}%)`;
                insights.push(`<li><b>Top Story by Total Bugs</b> ${infoIcon(explanation)}: Story <b>${maxStory}</b> has the highest bug count with ${maxCount} bugs (${percentage}% of total bugs).</li>`);
            }
        }
    }

    // 16. User Story with Highest Critical/High Bugs
    if (s.bugSeverityByStory) {
        const storyIds = Object.keys(s.bugSeverityByStory);
        if (storyIds.length > 0) {
            let maxStory = null;
            let maxHighCount = 0;
            let totalHighBugsAllStories = 0;
            for (let id in s.bugSeverityByStory) {
                const sev = s.bugSeverityByStory[id];
                const highCount = (sev.critical || 0) + (sev.high || 0);
                totalHighBugsAllStories += highCount;
                if (highCount > maxHighCount) {
                    maxHighCount = highCount;
                    maxStory = id;
                }
            }
            if (maxStory && maxHighCount > 0) {
                const percentage = ((maxHighCount / totalHighBugsAllStories) * 100).toFixed(1);
                const explanation = `Total Critical/High bugs across all stories = ${totalHighBugsAllStories}, Story '${maxStory}' has ${maxHighCount} Critical/High bugs (${percentage}%)`;
                insights.push(`<li><b>Top Story by Critical/High Bugs</b> ${infoIcon(explanation)}: Story <b>${maxStory}</b> has the highest number of Critical/High bugs (${maxHighCount} bugs, ${percentage}% of total Critical/High bugs).</li>`);
            }
        }
    }

    // ========== NEW: Highest Cycle Time Story with Comparisons ==========

// 17. Highest Cycle Time Story (compared to Estimation and Rework)
if (s.maxCycleTimeStoryId && s.maxCycleTime > 0) {
    const cycleDays = s.maxCycleTime;
    const estHours = s.maxCycleTimeStoryEst || 0;
    const reworkHours = s.maxCycleTimeStoryRework || 0;
    // Convert days to hours using 5-hour workday (as requested)
    const cycleHours = cycleDays * 5;
    const estVsCycleRatio = estHours > 0 ? ((cycleHours / estHours) * 100).toFixed(1) : 'N/A';
    const reworkVsCycleRatio = cycleHours > 0 ? ((reworkHours / cycleHours) * 100).toFixed(1) : 'N/A';
    const explanation = `Story '${s.maxCycleTimeStoryId}': Cycle Time = ${cycleDays} days (${cycleHours}h), Estimation = ${estHours.toFixed(1)}h, Rework = ${reworkHours.toFixed(1)}h. Cycle/Est = ${estVsCycleRatio}%, Rework/Cycle = ${reworkVsCycleRatio}%.`;
    insights.push(`<li><b>Highest Cycle Time Story</b> ${infoIcon(explanation)}: Story <b>${s.maxCycleTimeStoryId}</b> has the highest cycle time (${cycleDays} days, ${cycleHours}h). Total Estimation = ${estHours.toFixed(1)}h, Rework = ${reworkHours.toFixed(1)}h. Cycle/Est = ${estVsCycleRatio}%, Rework/Cycle = ${reworkVsCycleRatio}%.</li>`);
}

    // Fallback if no insights at all
    if (insights.length === 0) {
        return "<li><b>Balanced Quality Lifecycle</b> <span style=\"cursor:help; font-size:0.8em; color:#888; margin-left:4px;\" title=\"No metrics exceeded thresholds\">ⓘ</span>: No anomalies detected. All metrics are within typical ranges.</li>";
    }

    return insights.join('');
}

function renderPeopleView() {
    const container = document.getElementById('people-view');
    if (!container) return;

    const businessAreas = {};

    processedStories.forEach(us => {
        const area = us.businessArea || 'General';
        if (!businessAreas[area]) businessAreas[area] = {};
        const peopleMap = businessAreas[area];
        const isReport = us.title && us.title.toLowerCase().includes("patient reports");

        us.tasks.forEach(t => {
            const person = t['Assigned To'];
            if (!person) return;
            if (!peopleMap[person]) {
                peopleMap[person] = {
                    name: person,
                    devHours: 0,
                    testHours: 0,
                    dbHours: 0,
                    stories: new Set(),
                    reportStories: new Set(),
                    genericBugs: { count: 0, hours: 0 },
                    specificBugs: { count: 0, hours: 0 },
                    reviews: { count: 0, hours: 0 }
                };
            }
            const actDev = parseFloat(t['TimeSheet_DevActualTime']) || 0;
            const actTest = parseFloat(t['TimeSheet_TestingActualTime']) || 0;
            const activity = t['Activity'];
            if (activity === 'Testing') peopleMap[person].testHours += actTest;
            else if (activity === 'DB Modification') peopleMap[person].dbHours += actDev;
            else if (activity === 'Development') peopleMap[person].devHours += actDev;
            peopleMap[person].stories.add(us.id);
            if (isReport) peopleMap[person].reportStories.add(us.id);
        });

        const devLead = us.devLead;
        if (devLead && peopleMap[devLead]) {
            peopleMap[devLead].genericBugs.count += us.rework.generic.count;
            peopleMap[devLead].genericBugs.hours += us.rework.generic.actualTime;
            peopleMap[devLead].specificBugs.count += us.rework.specific.count;
            peopleMap[devLead].specificBugs.hours += us.rework.specific.actualTime;
        }
    });

    let html = `
        <div style="direction: ltr; text-align: left; font-family: 'Segoe UI', sans-serif;">
            <h2 style="margin-bottom:30px; color: #123b63; border-left: 6px solid #3498db; padding-left: 20px;">👥 Team Performance by Business Area</h2>`;

    for (let area in businessAreas) {
        html += `
            <div class="area-section" style="margin-bottom: 50px; border: 1px solid #ddd; border-radius: 8px; padding: 20px; background: #fcfcfc;">
                <h3 style="background: #2980b9; padding: 12px 20px; border-radius: 5px; color: white; margin-top: 0;">🏢 Business Area: ${area}</h3>`;

        const allPeople = Object.values(businessAreas[area]);
        const devs = allPeople.filter(p => p.devHours > 0);
        const testers = allPeople.filter(p => p.testHours > 0);
        const dbs = allPeople.filter(p => p.dbHours > 0);

        const renderRoleTable = (title, peopleList, color) => {
            if (peopleList.length === 0) return '';
            let tableHtml = `
                <div style="margin-top: 25px;">
                    <h4 style="color: ${color}; border-bottom: 2px solid ${color}; display: inline-block; padding-bottom: 5px;">${title}</h4>
                    <div class="table-container" style="overflow-x:auto; margin-top: 10px;">
                        <table style="width:100%; border-collapse: collapse; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            <thead>
                                <tr style="background: ${color}; color: Black;">
                                    <th style="padding: 12px; text-align: left;">Name</th>
                                    <th style="padding: 12px; text-align: center;">Stories</th>
                                    <th style="padding: 12px; text-align: center;">Reports</th>
                                    <th style="padding: 12px; text-align: center;">Dev Hours</th>
                                    <th style="padding: 12px; text-align: center;">Test Hours</th>
                                    <th style="padding: 12px; text-align: center;">DB Hours</th>
                                    <th style="padding: 12px; text-align: center;">Spec. Bugs</th>
                                    <th style="padding: 12px; text-align: center;">Gen. Bugs</th>
                                    <th style="padding: 12px; text-align: center;">Total</th>
                                  </tr>
                            </thead>
                            <tbody>`;
            peopleList.forEach(p => {
                const totalWork = p.devHours + p.testHours + p.dbHours;
                tableHtml += `
                    <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 10px; font-weight: bold; color: #34495e;">${p.name}</td>
                        <td style="padding: 10px; text-align: center;">${p.stories.size}</td>
                        <td style="padding: 10px; text-align: center; font-weight: bold; color: #2980b9; background: #f0f7ff;">${p.reportStories.size}</td>
                        <td style="padding: 10px; text-align: center;">${p.devHours.toFixed(1)}h</td>
                        <td style="padding: 10px; text-align: center;">${p.testHours.toFixed(1)}h</td>
                        <td style="padding: 10px; text-align: center;">${p.dbHours.toFixed(1)}h</td>
                        <td style="padding: 10px; text-align: center; background: #fff5f5;">
                            <span style="color: #c0392b; font-weight:bold;">${p.specificBugs.count}</span>
                            <br><small style="color: #666;">${p.specificBugs.hours.toFixed(1)}h</small>
                        </td>
                        <td style="padding: 10px; text-align: center; background: #fffaf5;">
                            <span style="color: #d35400; font-weight:bold;">${p.genericBugs.count}</span>
                            <br><small style="color: #666;">${p.genericBugs.hours.toFixed(1)}h</small>
                        </td>
                        <td style="padding: 10px; text-align: center; font-weight: bold;">${totalWork.toFixed(1)}h</td>
                    </tr>`;
            });
            tableHtml += `</tbody>table</div></div>`;
            return tableHtml;
        };

        html += renderRoleTable('💻 Development Team', devs, '#2c3e50');
        html += renderRoleTable('🧪 Testing Team', testers, '#27ae60');
        html += renderRoleTable('🗄️ Database Team', dbs, '#8e44ad');
        html += `</div>`;
    }
    html += `</div>`;
    container.innerHTML = html;
}

function renderNotTestedView() {
    const container = document.getElementById('not-tested-view');
    const notTested = processedStories.filter(us => us.status !== 'Tested');
    const grouped = groupBy(notTested, 'businessArea');
    
    let html = '<h2>Not Yet Tested - Detailed Analysis</h2>';
    if (notTested.length === 0) {
        html += '<div class="card"><p style="text-align:center; color: #27ae60; font-weight: bold;">✅ All Stories are Tested!</p></div>';
        container.innerHTML = html;
        return;
    }

    const formatDate = (date) => {
        if (!date || isNaN(new Date(date))) return 'N/A';
        return new Date(date).toLocaleString('en-GB', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
    };

    for (let area in grouped) {
        html += `<div class="business-section"><h3 class="business-area-title">${area}</h3>`;
        grouped[area].forEach(us => {
            const devTasksSorted = us.tasks.filter(t => t.Activity !== 'Testing')
                .sort((a, b) => new Date(a['Activated Date'] || 0) - new Date(b['Activated Date'] || 0));
            const testingTasksSorted = us.tasks.filter(t => t.Activity === 'Testing')
                .sort((a, b) => parseInt(a.id || 0) - parseInt(b.id || 0));
            const sortedTasks = [...devTasksSorted, ...testingTasksSorted];

            html += `
                <div class="card" style="margin-bottom: 30px; border-left: 5px solid #e67e22; overflow-x: auto;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h4>ID: ${us.id} - ${us.title}</h4>
                        <span style="background: #eee; padding: 2px 8px; border-radius: 4px; font-size: 0.8em;">Status: <b>${us.status}</b></span>
                    </div>
                    <p><b>Dev Lead:</b> ${us.devLead} | <b>Tester Lead:</b> ${us.testerLead}</p>
                    
                    <table style="width:100%; border-collapse:collapse; margin-bottom:15px;">
                        <thead><tr><th>Type</th><th>Est. (H)</th><th>Actual (H)</th><th>Effort Variance</th></tr></thead>
                        <tbody>
                            <tr><td>Dev</td><td>${us.devEffort.orig}</td><td>${us.devEffort.actual}</td><td class="${us.devEffort.dev < 1 ? 'alert-red' : ''}">${us.devEffort.dev.toFixed(2)}</td></tr>
                            <tr><td>Test</td><td>${us.testEffort.orig}</td><td>${us.testEffort.actual}</td><td class="${us.testEffort.dev < 1 ? 'alert-red' : ''}">${us.testEffort.dev.toFixed(2)}</td></tr>
                        </tbody>
                    </table>

                    <h5 style="margin: 10px 0;">Tasks Timeline:</h5>
                    <table style="font-size: 0.85em; width: 100%;">
                        <thead><tr style="background:#eee;"><th>ID</th><th>Task Name</th><th>Activity</th><th>Est</th><th>Exp. Start</th><th>Exp. End</th><th>Act. Start</th><th>TS Total</th><th>Delay</th>   </tr></thead>
                        <tbody>
                            ${sortedTasks.map(t => {
                                const tsTotal = (parseFloat(t['TimeSheet_DevActualTime']) || 0) + (parseFloat(t['TimeSheet_TestingActualTime']) || 0);
                                const est = parseFloat(t['Original Estimation']) || 0;
                                const delay = calculateHourDiff(t.expectedStart, t['Activated Date']);
                                return `
                                <tr>
                                    <td>${t['ID']}</td>
                                    <td style="max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${t['Title']}">${t['Title'] || 'N/A'}</td>
                                    <td>${t['Activity']}</td>
                                    <td>${est}</td>
                                    <td>${formatDate(t.expectedStart)}</td>
                                    <td>${formatDate(t.expectedEnd)}</td>
                                    <td>${formatDate(t['Activated Date'])}</td>
                                    <td>${tsTotal}</td>
                                    <td class="${delay > 0 ? 'alert-red' : ''}">${delay}h</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>`;
        });
        html += `</div>`;
    }
    container.innerHTML = html;
}

// ==================== HISTORICAL ANALYTICS FUNCTIONS (UPDATED) ====================

async function loadConfigsFromCloud() {
    if (!githubToken) return;
    try {
        const response = await fetch(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/azure_configs.json`, {
            headers: { 'Authorization': `token ${githubToken}` }
        });
        if (response.ok) {
            const data = await response.json();
            azureConfigsSha = data.sha;
            azureConfigs = JSON.parse(decodeURIComponent(escape(atob(data.content))));
            updateIterationDropdown();
            renderAzureConfigsTable();
        }
    } catch (error) {
        console.error("Error loading configs from cloud:", error);
    }
}

function updateIterationDropdown() {
    const select = document.getElementById('azureIterationSelect');
    if (!select) return;
    const savedQueries = azureConfigs || [];
    select.innerHTML = '<option value="">-- Select Iteration --</option>';
    savedQueries.forEach(config => {
        const option = document.createElement('option');
        option.value = JSON.stringify({ org: config.org || "", project: config.project || "", id: config.id || "" });
        option.textContent = config.name || `${config.project} - Query`;
        select.appendChild(option);
    });
}

async function fetchFromAzure() {
    const select = document.getElementById('azureIterationSelect');
    if (!select || select.value === "") return alert("Please select a query");
    const config = JSON.parse(select.value);
    const pat = localStorage.getItem('azure_pat');
    const statusDiv = document.getElementById('sync-status');
    if (!pat) return alert("Please enter Azure PAT in login screen");
    statusDiv.style.display = 'block';
    statusDiv.innerText = "⏳ Connecting to Azure DevOps...";
    try {
        const authHeader = { 'Authorization': 'Basic ' + btoa(':' + pat) };
        const wiqlUrl = `https://dev.azure.com/${config.org}/${config.project}/_apis/wit/wiql/${config.id}?api-version=6.0`;
        const wiqlRes = await fetch(wiqlUrl, { headers: authHeader });
        if (!wiqlRes.ok) throw new Error(`WIQL error: ${wiqlRes.status}`);
        const wiqlData = await wiqlRes.json();
        let workItemIds = [];
        if (wiqlData.workItemRelations) workItemIds = wiqlData.workItemRelations.map(rel => rel.target ? rel.target.id : null).filter(id => id !== null);
        else workItemIds = wiqlData.workItems.map(wi => wi.id);
        if (workItemIds.length === 0) { statusDiv.innerText = "⚠️ No results from query."; return; }
        statusDiv.innerText = `⏳ Found ${workItemIds.length} items, fetching details...`;
        let allItemsDetails = [];
        for (let i = 0; i < workItemIds.length; i += 200) {
            const chunk = workItemIds.slice(i, i + 200).join(',');
            const detailsUrl = `https://dev.azure.com/${config.org}/${config.project}/_apis/wit/workitems?ids=${chunk}&$expand=all&api-version=6.0`;
            const detailsRes = await fetch(detailsUrl, { headers: authHeader });
            const detailsData = await detailsRes.json();
            allItemsDetails = allItemsDetails.concat(detailsData.value);
            statusDiv.innerText = `⏳ Loading: ${allItemsDetails.length} / ${workItemIds.length}`;
        }
        rawData = allItemsDetails.map(item => mapAzureFields(item));
        processData(); 
        statusDiv.innerText = "✅ Data fetched successfully";
        showView('iteration-view');
    } catch (error) {
        console.error("Azure Integration Error:", error);
        statusDiv.innerText = "❌ Fetch failed: " + error.message;
    }
}

function mapAzureFields(item) {
    const f = item.fields;
    return {
        "ID": item.id,
        "Work Item Type": f["System.WorkItemType"],
        "State": f["System.State"],
        "Title": f["System.Title"],
        "Assigned To": f["System.AssignedTo"]?.displayName || f["System.AssignedTo"] || "",
        "Activity": f["Microsoft.VSTS.Common.Activity"] || "",
        "Original Estimation": f["NT.OriginalEstimation"] || 0,
        "TimeSheet_DevActualTime": f["Custom.TimeSheet_DevActualTime"] || 0,
        "TimeSheet_TestingActualTime": f["Custom.TimeSheet_TestingActualTime"] || 0,
        "Activated Date": f["Microsoft.VSTS.Common.ActivatedDate"] || "",
        "Business Area": f["MyCompany.MyProcess.BusinessArea"] || "General",
        "Iteration Path": f["System.IterationPath"] || "",
        "CustomResolvedDate": f["Custom.CustomResolvedDate"] || "",
        "Tested Date": f["MyCompany.MyProcess.TestedDate"] || "",
        "Assigned To Tester": f["MyCompany.MyProcess.Tester"]?.displayName || f["MyCompany.MyProcess.Tester"] || "",
        "Resolved Date": f["Microsoft.VSTS.Common.ResolvedDate"] || "",
        "Severity": f["Microsoft.VSTS.Common.Severity"] || "",
        "GenericBug": f["NT.GenericBug"] || "No",
        "BugType": f["NT.BugType"] || ""
    };
}

async function fetchIterationSummary(config) {
    const pat = localStorage.getItem('azure_pat');
    if (!pat) throw new Error("Azure PAT missing");
    const authHeader = { 'Authorization': 'Basic ' + btoa(':' + pat) };
    const wiqlUrl = `https://dev.azure.com/${config.org}/${config.project}/_apis/wit/wiql/${config.id}?api-version=6.0`;
    const wiqlRes = await fetch(wiqlUrl, { headers: authHeader });
    if (!wiqlRes.ok) throw new Error(`WIQL failed: ${wiqlRes.status}`);
    const wiqlData = await wiqlRes.json();
    let workItemIds = [];
    if (wiqlData.workItemRelations) workItemIds = wiqlData.workItemRelations.map(rel => rel.target ? rel.target.id : null).filter(id => id !== null);
    else workItemIds = wiqlData.workItems.map(wi => wi.id);
    if (workItemIds.length === 0) return null;
    let allItems = [];
    for (let i = 0; i < workItemIds.length; i += 200) {
        const chunk = workItemIds.slice(i, i + 200).join(',');
        const detailsUrl = `https://dev.azure.com/${config.org}/${config.project}/_apis/wit/workitems?ids=${chunk}&$expand=all&api-version=6.0`;
        const detailsRes = await fetch(detailsUrl, { headers: authHeader });
        const detailsData = await detailsRes.json();
        allItems.push(...detailsData.value);
    }
    const rawIterationData = allItems.map(item => mapAzureFields(item));
    
    // Separate Meeting work items
    const meetings = rawIterationData.filter(item => item['Work Item Type'] === 'Meeting');
    const nonMeetingItems = rawIterationData.filter(item => item['Work Item Type'] !== 'Meeting');
    
    // Build meeting hours per person (sum of DevActual + TestingActual from Meeting items)
    const meetingHoursByPerson = {};
    meetings.forEach(meeting => {
        const assignee = meeting['Assigned To'];
        if (!assignee) return;
        const devAct = parseFloat(meeting['TimeSheet_DevActualTime']) || 0;
        const testAct = parseFloat(meeting['TimeSheet_TestingActualTime']) || 0;
        const totalMeetingHrs = devAct + testAct;
        if (totalMeetingHrs > 0) {
            meetingHoursByPerson[assignee] = (meetingHoursByPerson[assignee] || 0) + totalMeetingHrs;
        }
    });
    
    const stories = buildStoriesFromRawDataForHistory(nonMeetingItems);
    calculateMetricsForStoriesForHistory(stories);
    
    let totalStories = stories.length;
    let totalEst = 0, totalDevActual = 0, totalTestActual = 0, totalDbActual = 0, totalBugActual = 0;
    let totalCycleTime = 0, cycleCount = 0;
    let totalInternalBugs = 0, totalUatBugs = 0;
    let closedCount = 0;
    let uniqueResources = new Set();
    let bugSeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    let bugTypeCount = { generic: 0, specific: 0 };
    let devCount = 0, testerCount = 0, dbCount = 0;
    const devSet = new Set(), testerSet = new Set(), dbSet = new Set();
    const businessMap = new Map();
    
    // Track meeting hours per resource for each business area (to include in averages later)
    // We'll accumulate meeting hours per person per business area
    const meetingHoursByPersonAndArea = new Map(); // key: area|person, value: hours
    
    stories.forEach(us => {
        const area = us.businessArea || 'General';
        if (!businessMap.has(area)) {
            businessMap.set(area, {
                totalStories: 0, totalEst: 0, totalDevActual: 0, totalTestActual: 0, totalDbActual: 0, totalBugActual: 0,
                totalCycleTime: 0, cycleCount: 0, totalInternalBugs: 0, totalUatBugs: 0, closedCount: 0,
                uniqueResources: new Set(), bugSeverity: { critical: 0, high: 0, medium: 0, low: 0 },
                bugTypeCount: { generic: 0, specific: 0 },
                devSet: new Set(), testerSet: new Set(), dbSet: new Set(),
                devMeetingHours: 0, testerMeetingHours: 0, dbMeetingHours: 0, // for including meeting time in averages
                devNames: [], testerNames: [], dbNames: []  // NEW: store names
            });
        }
        const ba = businessMap.get(area);
        
        const est = us.devEffort.orig + us.testEffort.orig + (us.dbEffort?.orig || 0);
        const devActCore = us.devEffort.actual;
        const testActCore = us.testEffort.actual;
        const dbActCore = us.dbEffort?.actual || 0;
        const bugAct = us.rework.actualTime;
        const reviewDevAct = us.reviewStats.devActual || 0;
        const reviewTestAct = us.reviewStats.testActual || 0;
        
        const totalDevForStory = devActCore + bugAct + reviewDevAct;
        const totalTestForStory = testActCore + reviewTestAct;
        const totalDbForStory = dbActCore;
        
        ba.totalEst += est;
        ba.totalDevActual += totalDevForStory;
        ba.totalTestActual += totalTestForStory;
        ba.totalDbActual += totalDbForStory;
        ba.totalBugActual += bugAct;
        ba.totalStories++;
        if (us.cycleTime > 0) { ba.totalCycleTime += us.cycleTime; ba.cycleCount++; }
        ba.totalInternalBugs += us.rework.count;
        ba.totalUatBugs += us.rework.uatBugsCount;
        if (us.status === 'Closed' || us.status === 'Tested' || us.status === 'Resolved' || us.status === 'To Be Reviewed') ba.closedCount++;
        
        if (us.devLead) ba.uniqueResources.add(us.devLead);
        if (us.testerLead) ba.uniqueResources.add(us.testerLead);
        us.tasks.forEach(t => {
            if (t['Assigned To']) ba.uniqueResources.add(t['Assigned To']);
            const assignee = t['Assigned To'];
            const act = t['Activity'];
            if (assignee) {
                if (act === 'Development') {
                    ba.devSet.add(assignee);
                    if (!ba.devNames.includes(assignee)) ba.devNames.push(assignee);
                }
                else if (act === 'Testing') {
                    ba.testerSet.add(assignee);
                    if (!ba.testerNames.includes(assignee)) ba.testerNames.push(assignee);
                }
                else if (act === 'DB Modification') {
                    ba.dbSet.add(assignee);
                    if (!ba.dbNames.includes(assignee)) ba.dbNames.push(assignee);
                }
            }
        });
        us.bugs.forEach(b => {
            const assignee = b['Assigned To'];
            if (assignee) {
                ba.uniqueResources.add(assignee);
                ba.devSet.add(assignee);
                if (!ba.devNames.includes(assignee)) ba.devNames.push(assignee);
            }
        });
        us.reviews.forEach(r => {
            const assignee = r['Assigned To'];
            if (assignee) {
                ba.uniqueResources.add(assignee);
                const act = r['Activity'];
                if (act === 'Development') {
                    ba.devSet.add(assignee);
                    if (!ba.devNames.includes(assignee)) ba.devNames.push(assignee);
                }
                else if (act === 'Testing') {
                    ba.testerSet.add(assignee);
                    if (!ba.testerNames.includes(assignee)) ba.testerNames.push(assignee);
                }
            }
        });
        
        ba.bugSeverity.critical += us.rework.severity.critical;
        ba.bugSeverity.high += us.rework.severity.high;
        ba.bugSeverity.medium += us.rework.severity.medium;
        ba.bugSeverity.low += us.rework.severity.low;
        ba.bugTypeCount.generic += us.rework.generic.count;
        ba.bugTypeCount.specific += us.rework.specific.count;
        
        // Aggregate totals for overall iteration
        totalEst += est;
        totalDevActual += totalDevForStory;
        totalTestActual += totalTestForStory;
        totalDbActual += totalDbForStory;
        totalBugActual += bugAct;
        if (us.cycleTime > 0) { totalCycleTime += us.cycleTime; cycleCount++; }
        totalInternalBugs += us.rework.count;
        totalUatBugs += us.rework.uatBugsCount;
        if (us.status === 'Closed' || us.status === 'Tested' || us.status === 'Resolved' || us.status === 'To Be Reviewed') closedCount++;
        if (us.devLead) uniqueResources.add(us.devLead);
        if (us.testerLead) uniqueResources.add(us.testerLead);
        us.tasks.forEach(t => {
            if (t['Assigned To']) uniqueResources.add(t['Assigned To']);
            const assignee = t['Assigned To'];
            const act = t['Activity'];
            if (assignee) {
                if (act === 'Development') devSet.add(assignee);
                else if (act === 'Testing') testerSet.add(assignee);
                else if (act === 'DB Modification') dbSet.add(assignee);
            }
        });
        us.bugs.forEach(b => {
            const assignee = b['Assigned To'];
            if (assignee) {
                uniqueResources.add(assignee);
                devSet.add(assignee);
            }
        });
        us.reviews.forEach(r => {
            const assignee = r['Assigned To'];
            if (assignee) {
                uniqueResources.add(assignee);
                const act = r['Activity'];
                if (act === 'Development') devSet.add(assignee);
                else if (act === 'Testing') testerSet.add(assignee);
            }
        });
        
        bugSeverity.critical += us.rework.severity.critical;
        bugSeverity.high += us.rework.severity.high;
        bugSeverity.medium += us.rework.severity.medium;
        bugSeverity.low += us.rework.severity.low;
        bugTypeCount.generic += us.rework.generic.count;
        bugTypeCount.specific += us.rework.specific.count;
    });
    
    // Now assign meeting hours to business areas based on the persons' roles within that area
    // For each person in each business area's role sets, we add meeting hours from meetingHoursByPerson (global, no area filter)
    // But meetings are not area-specific in the data, so we assume meeting hours belong to the area where the person worked on stories.
    // We'll allocate meeting hours to a business area if the person appears in that area's devSet, testerSet, or dbSet.
    for (let [area, ba] of businessMap.entries()) {
        let devMeetingTotal = 0, testerMeetingTotal = 0, dbMeetingTotal = 0;
        // For each person in devSet, add their meeting hours
        ba.devSet.forEach(person => {
            const hrs = meetingHoursByPerson[person] || 0;
            devMeetingTotal += hrs;
        });
        ba.testerSet.forEach(person => {
            const hrs = meetingHoursByPerson[person] || 0;
            testerMeetingTotal += hrs;
        });
        ba.dbSet.forEach(person => {
            const hrs = meetingHoursByPerson[person] || 0;
            dbMeetingTotal += hrs;
        });
        ba.devMeetingHours = devMeetingTotal;
        ba.testerMeetingHours = testerMeetingTotal;
        ba.dbMeetingHours = dbMeetingTotal;
    }
    
    // Collect overall names for the whole iteration (unique across all business areas)
    let overallDevNames = [], overallTesterNames = [], overallDbNames = [];
    for (let [area, ba] of businessMap.entries()) {
        overallDevNames.push(...ba.devNames);
        overallTesterNames.push(...ba.testerNames);
        overallDbNames.push(...ba.dbNames);
    }
    // Remove duplicates
    overallDevNames = [...new Set(overallDevNames)];
    overallTesterNames = [...new Set(overallTesterNames)];
    overallDbNames = [...new Set(overallDbNames)];
    
    devCount = devSet.size;
    testerCount = testerSet.size;
    dbCount = dbSet.size;
    
    const avgCycleTime = cycleCount ? (totalCycleTime / cycleCount).toFixed(1) : 0;
    const effortVariance = totalEst ? ((totalDevActual + totalTestActual - totalEst) / totalEst) * 100 : 0;
    const totalBugs = totalInternalBugs + totalUatBugs;
    const dre = totalBugs ? (totalInternalBugs / totalBugs) * 100 : 100;
    const reworkRatio = (totalDevActual + totalTestActual) ? (totalBugActual / (totalDevActual + totalTestActual)) * 100 : 0;
    const avgHoursPerResource = uniqueResources.size ? (totalDevActual + totalTestActual) / uniqueResources.size : 0;
    const avgDevHours = devCount ? totalDevActual / devCount : 0;
    const avgTestHours = testerCount ? totalTestActual / testerCount : 0;
    const avgDbHours = dbCount ? totalDbActual / dbCount : 0;
    
    // Compute meeting-inclusive averages for overall iteration
    let totalDevMeetingHours = 0, totalTesterMeetingHours = 0, totalDbMeetingHours = 0;
    for (let [area, ba] of businessMap.entries()) {
        totalDevMeetingHours += ba.devMeetingHours || 0;
        totalTesterMeetingHours += ba.testerMeetingHours || 0;
        totalDbMeetingHours += ba.dbMeetingHours || 0;
    }
    const avgDevHoursInclMeetings = devCount ? (totalDevActual + totalDevMeetingHours) / devCount : 0;
    const avgTestHoursInclMeetings = testerCount ? (totalTestActual + totalTesterMeetingHours) / testerCount : 0;
    const avgDbHoursInclMeetings = dbCount ? (totalDbActual + totalDbMeetingHours) / dbCount : 0;
    
    const businessMetrics = [];
    for (let [area, ba] of businessMap.entries()) {
        const baAvgCycle = ba.cycleCount ? (ba.totalCycleTime / ba.cycleCount).toFixed(1) : 0;
        const baEffortVar = ba.totalEst ? ((ba.totalDevActual + ba.totalTestActual - ba.totalEst) / ba.totalEst) * 100 : 0;
        const baTotalBugs = ba.totalInternalBugs + ba.totalUatBugs;
        const baDre = baTotalBugs ? (ba.totalInternalBugs / baTotalBugs) * 100 : 100;
        const baReworkRatio = (ba.totalDevActual + ba.totalTestActual) ? (ba.totalBugActual / (ba.totalDevActual + ba.totalTestActual)) * 100 : 0;
        const baAvgHoursPerRes = ba.uniqueResources.size ? (ba.totalDevActual + ba.totalTestActual) / ba.uniqueResources.size : 0;
        const baAvgDevHours = ba.devSet.size ? ba.totalDevActual / ba.devSet.size : 0;
        const baAvgTestHours = ba.testerSet.size ? ba.totalTestActual / ba.testerSet.size : 0;
        const baAvgDbHours = ba.dbSet.size ? ba.totalDbActual / ba.dbSet.size : 0;
        
        // Meeting-inclusive averages for business area
        const baAvgDevHoursIncl = ba.devSet.size ? (ba.totalDevActual + ba.devMeetingHours) / ba.devSet.size : 0;
        const baAvgTestHoursIncl = ba.testerSet.size ? (ba.totalTestActual + ba.testerMeetingHours) / ba.testerSet.size : 0;
        const baAvgDbHoursIncl = ba.dbSet.size ? (ba.totalDbActual + ba.dbMeetingHours) / ba.dbSet.size : 0;
        
        businessMetrics.push({
            area: area,
            totalStories: ba.totalStories,
            completedStories: ba.closedCount,
            avgCycleTime: parseFloat(baAvgCycle),
            effortVariance: parseFloat(baEffortVar.toFixed(1)),
            dre: parseFloat(baDre.toFixed(1)),
            internalBugs: ba.totalInternalBugs,
            uatBugs: ba.totalUatBugs,
            totalDevActual: parseFloat(ba.totalDevActual.toFixed(1)),
            totalTestActual: parseFloat(ba.totalTestActual.toFixed(1)),
            totalDbActual: parseFloat(ba.totalDbActual.toFixed(1)),
            totalBugActual: parseFloat(ba.totalBugActual.toFixed(1)),
            uniqueResourcesCount: ba.uniqueResources.size,
            avgHoursPerResource: parseFloat(baAvgHoursPerRes.toFixed(1)),
            avgDevHours: parseFloat(baAvgDevHours.toFixed(1)),
            avgTestHours: parseFloat(baAvgTestHours.toFixed(1)),
            avgDbHours: parseFloat(baAvgDbHours.toFixed(1)),
            avgDevHoursInclMeetings: parseFloat(baAvgDevHoursIncl.toFixed(1)),
            avgTestHoursInclMeetings: parseFloat(baAvgTestHoursIncl.toFixed(1)),
            avgDbHoursInclMeetings: parseFloat(baAvgDbHoursIncl.toFixed(1)),
            bugSeverity: ba.bugSeverity,
            bugTypeCount: ba.bugTypeCount,
            reworkRatio: parseFloat(baReworkRatio.toFixed(1)),
            devCount: ba.devSet.size,
            testerCount: ba.testerSet.size,
            dbCount: ba.dbSet.size,
            devNames: ba.devNames,    // NEW
            testerNames: ba.testerNames, // NEW
            dbNames: ba.dbNames       // NEW
        });
    }
    
    return {
        iterationName: config.name,
        totalStories: totalStories,
        completedStories: closedCount,
        avgCycleTime: parseFloat(avgCycleTime),
        effortVariance: parseFloat(effortVariance.toFixed(1)),
        dre: parseFloat(dre.toFixed(1)),
        internalBugs: totalInternalBugs,
        uatBugs: totalUatBugs,
        totalDevActual: parseFloat(totalDevActual.toFixed(1)),
        totalTestActual: parseFloat(totalTestActual.toFixed(1)),
        totalDbActual: parseFloat(totalDbActual.toFixed(1)),
        totalBugActual: parseFloat(totalBugActual.toFixed(1)),
        uniqueResourcesCount: uniqueResources.size,
        avgHoursPerResource: parseFloat(avgHoursPerResource.toFixed(1)),
        avgDevHours: parseFloat(avgDevHours.toFixed(1)),
        avgTestHours: parseFloat(avgTestHours.toFixed(1)),
        avgDbHours: parseFloat(avgDbHours.toFixed(1)),
        avgDevHoursInclMeetings: parseFloat(avgDevHoursInclMeetings.toFixed(1)),
        avgTestHoursInclMeetings: parseFloat(avgTestHoursInclMeetings.toFixed(1)),
        avgDbHoursInclMeetings: parseFloat(avgDbHoursInclMeetings.toFixed(1)),
        bugSeverity: bugSeverity,
        bugTypeCount: bugTypeCount,
        reworkRatio: parseFloat(reworkRatio.toFixed(1)),
        devCount: devCount,
        testerCount: testerCount,
        dbCount: dbCount,
        devNames: overallDevNames,   // NEW: array of developer names for this iteration (overall)
        testerNames: overallTesterNames, // NEW
        dbNames: overallDbNames,     // NEW
        businessMetrics: businessMetrics
    };
}

function renderMultiLineChart(canvasId, labels, datasets, yLabel = '') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (window[canvasId + 'Chart']) window[canvasId + 'Chart'].destroy();
    window[canvasId + 'Chart'] = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: { title: { display: !!yLabel, text: yLabel } }
            }
        }
    });
}

// Helper chart functions with tooltips that show names
function renderStackedBarChartWithNames(canvasId, labels, datasets, yLabel, namesData) {
    // namesData is an object with keys: 'Developers', 'Testers', 'DB Specialists' each an array of arrays (per label)
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (window[canvasId + 'Chart']) window[canvasId + 'Chart'].destroy();
    
    window[canvasId + 'Chart'] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: yLabel } } },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            let value = context.raw;
                            let index = context.dataIndex;
                            let namesList = [];
                            if (label === 'Developers' && namesData.developers && namesData.developers[index]) {
                                namesList = namesData.developers[index];
                            } else if (label === 'Testers' && namesData.testers && namesData.testers[index]) {
                                namesList = namesData.testers[index];
                            } else if (label === 'DB Specialists' && namesData.db && namesData.db[index]) {
                                namesList = namesData.db[index];
                            }
                            if (namesList && namesList.length) {
                                return `${label}: ${value} (${namesList.join(', ')})`;
                            } else {
                                return `${label}: ${value}`;
                            }
                        }
                    }
                }
            }
        }
    });
}

function renderFilteredCharts(historicalData, selectedArea) {
    if (!historicalData || historicalData.length === 0) return;
    const metricsByIteration = [];
    const labels = [];
    for (let iter of historicalData) {
        if (iter.businessMetrics && Array.isArray(iter.businessMetrics)) {
            const baMetric = iter.businessMetrics.find(b => b.area === selectedArea);
            if (baMetric) {
                labels.push(iter.iterationName);
                metricsByIteration.push(baMetric);
            }
        }
    }
    if (metricsByIteration.length === 0) {
        document.getElementById('filteredChartsMessage').innerText = `No data for business area: ${selectedArea}`;
        return;
    }
    document.getElementById('filteredChartsMessage').innerText = `Showing detailed trends for: ${selectedArea}`;
    
    const evData = metricsByIteration.map(m => m.effortVariance);
    renderLineChart('filteredEvChart', labels, evData, 'Effort Variance %', '#f39c12', 'Variance %');
    const rwData = metricsByIteration.map(m => m.reworkRatio);
    renderLineChart('filteredRwChart', labels, rwData, 'Rework Ratio %', '#e67e22', 'Rework %');
    const ctData = metricsByIteration.map(m => m.avgCycleTime);
    renderLineChart('filteredCtChart', labels, ctData, 'Cycle Time (days)', '#3498db', 'Days');
    
    // Workload with Meeting dashed lines
    const devWorkloadSolid = metricsByIteration.map(m => m.avgDevHours || 0);
    const devWorkloadIncl = metricsByIteration.map(m => m.avgDevHoursInclMeetings || 0);
    const testWorkloadSolid = metricsByIteration.map(m => m.avgTestHours || 0);
    const testWorkloadIncl = metricsByIteration.map(m => m.avgTestHoursInclMeetings || 0);
    const dbWorkloadSolid = metricsByIteration.map(m => m.avgDbHours || 0);
    const dbWorkloadIncl = metricsByIteration.map(m => m.avgDbHoursInclMeetings || 0);
    
    renderMultiLineChart('filteredAvgWorkloadChart', labels, [
        { label: 'Developers (avg hours)', data: devWorkloadSolid, borderColor: '#2c3e50', backgroundColor: 'transparent', tension: 0.3, fill: false, pointBackgroundColor: '#2c3e50' },
        { label: 'Developers + Meeting (avg hours)', data: devWorkloadIncl, borderColor: '#2c3e50', backgroundColor: 'transparent', tension: 0.3, fill: false, pointBackgroundColor: '#2c3e50', borderDash: [5,5] },
        { label: 'Testers (avg hours)', data: testWorkloadSolid, borderColor: '#27ae60', backgroundColor: 'transparent', tension: 0.3, fill: false, pointBackgroundColor: '#27ae60' },
        { label: 'Testers + Meeting (avg hours)', data: testWorkloadIncl, borderColor: '#27ae60', backgroundColor: 'transparent', tension: 0.3, fill: false, pointBackgroundColor: '#27ae60', borderDash: [5,5] },
        { label: 'DB Specialists (avg hours)', data: dbWorkloadSolid, borderColor: '#8e44ad', backgroundColor: 'transparent', tension: 0.3, fill: false, pointBackgroundColor: '#8e44ad' },
        { label: 'DB Specialists + Meeting (avg hours)', data: dbWorkloadIncl, borderColor: '#8e44ad', backgroundColor: 'transparent', tension: 0.3, fill: false, pointBackgroundColor: '#8e44ad', borderDash: [5,5] }
    ], 'Hours per Resource');
    
    // Resource distribution chart with names
    const devCounts = metricsByIteration.map(m => m.devCount || 0);
    const testerCounts = metricsByIteration.map(m => m.testerCount || 0);
    const dbCounts = metricsByIteration.map(m => m.dbCount || 0);
    const devNamesList = metricsByIteration.map(m => m.devNames || []);
    const testerNamesList = metricsByIteration.map(m => m.testerNames || []);
    const dbNamesList = metricsByIteration.map(m => m.dbNames || []);
    renderStackedBarChartWithNames('filteredResourceDistChart', labels, [
        { label: 'Developers', data: devCounts, backgroundColor: '#2c3e50' },
        { label: 'Testers', data: testerCounts, backgroundColor: '#27ae60' },
        { label: 'DB Specialists', data: dbCounts, backgroundColor: '#8e44ad' }
    ], 'Headcount', { developers: devNamesList, testers: testerNamesList, db: dbNamesList });
    
    const severityCritical = metricsByIteration.map(m => m.bugSeverity?.critical || 0);
    const severityHigh = metricsByIteration.map(m => m.bugSeverity?.high || 0);
    const severityMedium = metricsByIteration.map(m => m.bugSeverity?.medium || 0);
    const severityLow = metricsByIteration.map(m => m.bugSeverity?.low || 0);
    renderStackedPercentageBar('filteredBugSeverityChart', labels, [
        { label: 'Critical', data: severityCritical, backgroundColor: '#c0392b' },
        { label: 'High', data: severityHigh, backgroundColor: '#e67e22' },
        { label: 'Medium', data: severityMedium, backgroundColor: '#f1c40f' },
        { label: 'Low', data: severityLow, backgroundColor: '#2ecc71' }
    ], 'Bug Severity');
    
    const genericBugs = metricsByIteration.map(m => m.bugTypeCount?.generic || 0);
    const specificBugs = metricsByIteration.map(m => m.bugTypeCount?.specific || 0);
    renderStackedPercentageBar('filteredBugTypeChart', labels, [
        { label: 'Generic Bugs', data: genericBugs, backgroundColor: '#e67e22' },
        { label: 'Specific Bugs', data: specificBugs, backgroundColor: '#3498db' }
    ], 'Bug Type');
}

async function syncAllIterationsData() {
    if (!azureConfigs || azureConfigs.length === 0) {
        alert("No Azure iterations configured. Please add queries in Azure Config first.");
        return;
    }
    const statusDiv = document.getElementById('sync-status');
    statusDiv.style.display = 'block';
    const summaries = [];
    for (let i = 0; i < azureConfigs.length; i++) {
        const config = azureConfigs[i];
        statusDiv.innerText = `⏳ Fetching ${config.name} (${i+1}/${azureConfigs.length})...`;
        try {
            const summary = await fetchIterationSummary(config);
            if (summary) summaries.push(summary);
            await new Promise(r => setTimeout(r, 500));
        } catch (err) {
            console.error(`Failed for ${config.name}:`, err);
            statusDiv.innerText = `⚠️ Error on ${config.name}: ${err.message}`;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    if (summaries.length) {
        await uploadHistoricalSummary(summaries);
        localStorage.setItem('historical_summaries', JSON.stringify(summaries));
        statusDiv.innerText = `✅ Synced ${summaries.length} iterations to historical data.`;
    } else {
        statusDiv.innerText = "❌ No summary data collected.";
    }
    setTimeout(() => statusDiv.style.display = 'none', 3000);
}

async function uploadHistoricalSummary(summaries) {
    if (!githubToken) {
        console.error("No GitHub token available");
        return;
    }

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(summaries, null, 2))));
    const fileUrl = `https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/historical_summary.json`;
    let sha = null;

    // 1. محاولة جلب الملف للحصول على sha
    try {
        // أضف ?ref=BRANCH للتأكد من القراءة من الفرع الصحيح
        const getUrl = `${fileUrl}?ref=${GH_CONFIG.branch}`;
        const getRes = await fetch(getUrl, {
            headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (getRes.status === 200) {
            const data = await getRes.json();
            console.log("Full file metadata from GitHub:", data); // للتشخيص
            if (data.sha) {
                sha = data.sha;
                console.log("File exists, sha:", sha);
            } else {
                console.warn("File exists but sha field missing. Response structure:", Object.keys(data));
                // محاولة بديلة: قد يكون الـ sha موجوداً داخل content.sha? لكن API الرسمي يضعه في الجذر.
                // إذا لم نجده نعتبر الملف تالفاً ونتابع بدون sha (سيتم رفض الطلب، لكننا سنجرب)
            }
        } else if (getRes.status === 404) {
            console.log("File does not exist, will create new one");
            sha = null;
        } else {
            console.warn(`Unexpected status ${getRes.status} while fetching file info`);
            throw new Error(`Failed to get file info: ${getRes.status}`);
        }
    } catch (err) {
        console.error("Error checking existing file:", err);
        // لا نرمي الخطأ فوراً، بل نحاول المتابعة بدون sha (قد ينجح إذا كان الملف غير موجود فعلاً)
        // لكن الأفضل إيقاف العملية لأنها فشلت في تحديد حالة الملف
        throw err;
    }

    // 2. بناء جسم الطلب
    const body = {
        message: "Update historical iteration summaries",
        content: content,
        branch: GH_CONFIG.branch
    };
    if (sha) {
        body.sha = sha;
    } else if (sha === null && (await fileExistsOnGitHub(fileUrl))) {
        // إذا كان الملف موجوداً لكننا فشلنا في الحصول على sha، نرفض المتابعة
        throw new Error("Cannot update existing file: missing sha. Please delete the file manually or check permissions.");
    }

    // 3. تنفيذ PUT
    const putRes = await fetch(fileUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${githubToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify(body)
    });

    if (!putRes.ok) {
        const errorText = await putRes.text();
        console.error("GitHub PUT error:", putRes.status, errorText);
        throw new Error(`Failed to upload: ${putRes.status} ${errorText}`);
    }

    console.log("Upload successful");
}

// دالة مساعدة للتحقق من وجود الملف (اختيارية)
async function fileExistsOnGitHub(fileUrl) {
    try {
        const res = await fetch(`${fileUrl}?ref=${GH_CONFIG.branch}`, {
            headers: { 'Authorization': `token ${githubToken}` }
        });
        return res.status === 200;
    } catch {
        return false;
    }
}

async function loadHistoricalSummary() {
    if (!githubToken) return null;
    try {
        const res = await fetch(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/historical_summary.json`, {
            headers: { 'Authorization': `token ${githubToken}`, 'Accept': 'application/vnd.github.v3.raw' }
        });
        if (res.ok) {
            const content = await res.text();
            return JSON.parse(content);
        } else if (res.status === 404) {
            console.log("No historical summary file yet.");
        }
    } catch (e) {
        console.warn("Error loading historical summary:", e);
    }
    const local = localStorage.getItem('historical_summaries');
    return local ? JSON.parse(local) : [];
}

// Helper chart functions
function renderLineChart(canvasId, labels, data, label, color, yLabel = '') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (window[canvasId + 'Chart']) window[canvasId + 'Chart'].destroy();
    window[canvasId + 'Chart'] = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{ label: label, data: data, borderColor: color, backgroundColor: 'transparent', tension: 0.3, fill: false, pointBackgroundColor: color }] },
        options: { responsive: true, maintainAspectRatio: true, scales: { y: { title: { display: !!yLabel, text: yLabel } } } }
    });
}

function renderStackedBarChart(canvasId, labels, datasets, yLabel) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (window[canvasId + 'Chart']) window[canvasId + 'Chart'].destroy();
    window[canvasId + 'Chart'] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: datasets },
        options: { responsive: true, maintainAspectRatio: true, scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: yLabel } } } }
    });
}

function renderStackedPercentageBar(canvasId, labels, datasets, title) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (window[canvasId + 'Chart']) window[canvasId + 'Chart'].destroy();
    window[canvasId + 'Chart'] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                x: { stacked: true },
                y: {
                    stacked: true,
                    title: { display: true, text: 'Percentage (%)' },
                    max: 100,
                    ticks: { callback: (val) => val + '%' }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const datasetIndex = context.datasetIndex;
                            const dataIndex = context.dataIndex;
                            const rawValue = context.raw;
                            // Sum all datasets for the same label (iteration)
                            let totalForLabel = 0;
                            context.chart.data.datasets.forEach(dataset => {
                                totalForLabel += dataset.data[dataIndex] || 0;
                            });
                            const percentage = totalForLabel > 0 ? (rawValue / totalForLabel) * 100 : 0;
                            return `${context.dataset.label}: ${rawValue} (${percentage.toFixed(1)}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ==================== HEATMAP HELPER ====================
function buildHeatmapTable(data) {
    if (!data || data.length === 0) return '<p style="color:#7f8c8d;">لا توجد بيانات كافية للـ Heatmap.</p>';

    const metrics = ['CT', 'RW', 'EV', 'Bugs'];
    const ranges = {};
    metrics.forEach(m => {
        const values = data.map(d => d[m]).filter(v => v !== undefined && v !== null);
        ranges[m] = { min: Math.min(...values), max: Math.max(...values) };
    });

    const getColor = (value, min, max) => {
        if (max === min) return '#2ecc71'; // لون محايد إذا كانت القيم متساوية
        const ratio = (value - min) / (max - min); // 0 ← أخضر, 1 ← أحمر
        const r = Math.round(255 * ratio);
        const g = Math.round(255 * (1 - ratio));
        return `rgb(${r}, ${g}, 80)`;
    };

    let html = `
        <div style="overflow-x:auto; margin-top:20px;">
            <table style="width:100%; border-collapse:collapse; font-size:0.95em; box-shadow:0 2px 8px rgba(0,0,0,0.1); border-radius:8px; overflow:hidden;">
                <thead>
                    <tr style="background:#2c3e50; color:white;">
                        <th style="padding:12px; text-align:center;">Iteration</th>
                        <th style="padding:12px; text-align:center;">Cycle Time (days)</th>
                        <th style="padding:12px; text-align:center;">Rework %</th>
                        <th style="padding:12px; text-align:center;">Effort Variance %</th>
                        <th style="padding:12px; text-align:center;">Bugs</th>
                    </tr>
                </thead>
                <tbody>
    `;

    data.forEach(row => {
        html += `<tr>`;
        html += `<td style="padding:12px; text-align:center; font-weight:600; background:#f8f9fa;">${row.iteration}</td>`;
        metrics.forEach(m => {
            const val = row[m];
            const { min, max } = ranges[m];
            const color = getColor(val, min, max);
            const display = typeof val === 'number' ? val.toFixed(1) : val;
            html += `
                <td style="padding:12px; text-align:center; background-color:${color}; color:${val > (min+max)/2 ? 'white' : '#2c3e50'}; font-weight:bold; cursor:help;" 
                    title="${m}: ${display}">
                    ${display}
                </td>
            `;
        });
        html += `</tr>`;
    });

    html += `</tbody>table</div>`;
    return html;
}

// ==================== UPDATED renderHistoricalAnalyticsView ====================
async function renderHistoricalAnalyticsView() {
    const container = document.getElementById('historical-analytics-view');
    if (!container) return;

    // Use cached data if available, else load from GitHub
    let historicalData = window.__historicalData;
    if (!historicalData) {
        historicalData = await loadHistoricalSummary();
        window.__historicalData = historicalData;
    }
    if (!historicalData || historicalData.length === 0) {
        container.innerHTML = `<div class="card"><p>No historical data available. Please click "Sync All Iterations Data" first.</p></div>`;
        return;
    }

    // Sort according to azureConfigs order (preserve insertion order)
    const configOrder = azureConfigs.map(cfg => cfg.name);
    const orderMap = new Map();
    configOrder.forEach((name, idx) => orderMap.set(name, idx));
    historicalData.sort((a, b) => {
        const idxA = orderMap.has(a.iterationName) ? orderMap.get(a.iterationName) : configOrder.length;
        const idxB = orderMap.has(b.iterationName) ? orderMap.get(b.iterationName) : configOrder.length;
        return idxA - idxB;
    });

    const labels = historicalData.map(d => d.iterationName);

    // ---- Overall charts (always shown) ----
    renderLineChart('evLineChart', labels, historicalData.map(d => d.effortVariance), 'Effort Variance %', '#f39c12', 'Variance %');
    renderLineChart('rwLineChart', labels, historicalData.map(d => d.reworkRatio), 'Rework Ratio %', '#e67e22', 'Rework %');
    renderLineChart('ctLineChart', labels, historicalData.map(d => d.avgCycleTime), 'Cycle Time (days)', '#3498db', 'Days');

    // Multi-line workload chart (Dev, Tester, DB) with meetings as dashed
    const devWorkloadSolid = historicalData.map(d => d.avgDevHours || 0);
    const devWorkloadIncl = historicalData.map(d => d.avgDevHoursInclMeetings || 0);
    const testWorkloadSolid = historicalData.map(d => d.avgTestHours || 0);
    const testWorkloadIncl = historicalData.map(d => d.avgTestHoursInclMeetings || 0);
    const dbWorkloadSolid = historicalData.map(d => d.avgDbHours || 0);
    const dbWorkloadIncl = historicalData.map(d => d.avgDbHoursInclMeetings || 0);
    
    renderMultiLineChart('avgWorkloadLineChart', labels, [
        { label: 'Developers (avg hours)', data: devWorkloadSolid, borderColor: '#2c3e50', backgroundColor: 'transparent', tension: 0.3, fill: false, pointBackgroundColor: '#2c3e50' },
        { label: 'Developers + Meeting (avg hours)', data: devWorkloadIncl, borderColor: '#2c3e50', backgroundColor: 'transparent', tension: 0.3, fill: false, pointBackgroundColor: '#2c3e50', borderDash: [5,5] },
        { label: 'Testers (avg hours)', data: testWorkloadSolid, borderColor: '#27ae60', backgroundColor: 'transparent', tension: 0.3, fill: false, pointBackgroundColor: '#27ae60' },
        { label: 'Testers + Meeting (avg hours)', data: testWorkloadIncl, borderColor: '#27ae60', backgroundColor: 'transparent', tension: 0.3, fill: false, pointBackgroundColor: '#27ae60', borderDash: [5,5] },
        { label: 'DB Specialists (avg hours)', data: dbWorkloadSolid, borderColor: '#8e44ad', backgroundColor: 'transparent', tension: 0.3, fill: false, pointBackgroundColor: '#8e44ad' },
        { label: 'DB Specialists + Meeting (avg hours)', data: dbWorkloadIncl, borderColor: '#8e44ad', backgroundColor: 'transparent', tension: 0.3, fill: false, pointBackgroundColor: '#8e44ad', borderDash: [5,5] }
    ], 'Hours per Resource');

    // Resource distribution chart with names (stacked bar)
    const devCounts = historicalData.map(d => d.devCount || 0);
    const testerCounts = historicalData.map(d => d.testerCount || 0);
    const dbCounts = historicalData.map(d => d.dbCount || 0);
    const devNamesList = historicalData.map(d => d.devNames || []);
    const testerNamesList = historicalData.map(d => d.testerNames || []);
    const dbNamesList = historicalData.map(d => d.dbNames || []);
    renderStackedBarChartWithNames('resourceDistChart', labels, [
        { label: 'Developers', data: devCounts, backgroundColor: '#2c3e50' },
        { label: 'Testers', data: testerCounts, backgroundColor: '#27ae60' },
        { label: 'DB Specialists', data: dbCounts, backgroundColor: '#8e44ad' }
    ], 'Headcount', { developers: devNamesList, testers: testerNamesList, db: dbNamesList });

    // Bug severity distribution (stacked percentage)
    const severityCritical = historicalData.map(d => d.bugSeverity?.critical || 0);
    const severityHigh = historicalData.map(d => d.bugSeverity?.high || 0);
    const severityMedium = historicalData.map(d => d.bugSeverity?.medium || 0);
    const severityLow = historicalData.map(d => d.bugSeverity?.low || 0);
    renderStackedPercentageBar('bugSeverityChart', labels, [
        { label: 'Critical', data: severityCritical, backgroundColor: '#c0392b' },
        { label: 'High', data: severityHigh, backgroundColor: '#e67e22' },
        { label: 'Medium', data: severityMedium, backgroundColor: '#f1c40f' },
        { label: 'Low', data: severityLow, backgroundColor: '#2ecc71' }
    ], 'Bug Severity');

    // Bug type distribution (stacked percentage)
    const genericBugs = historicalData.map(d => d.bugTypeCount?.generic || 0);
    const specificBugs = historicalData.map(d => d.bugTypeCount?.specific || 0);
    renderStackedPercentageBar('bugTypeChart', labels, [
        { label: 'Generic Bugs', data: genericBugs, backgroundColor: '#e67e22' },
        { label: 'Specific Bugs', data: specificBugs, backgroundColor: '#3498db' }
    ], 'Bug Type');

    // ---- Business Area filter dropdown ----
    const allAreas = new Set();
    historicalData.forEach(iter => {
        if (iter.businessMetrics && Array.isArray(iter.businessMetrics)) {
            iter.businessMetrics.forEach(b => allAreas.add(b.area));
        }
    });
    const areasArray = Array.from(allAreas).sort();

    let areaSelect = document.getElementById('businessAreaSelect');
    if (!areaSelect) {
        const filterDiv = document.createElement('div');
        filterDiv.style.margin = '20px 0';
        filterDiv.innerHTML = `
            <label for="businessAreaSelect" style="font-weight:bold; margin-right:10px;">Filter by Business Area:</label>
            <select id="businessAreaSelect" onchange="onBusinessAreaChange()">
                <option value="">-- All Areas (Overall) --</option>
                ${areasArray.map(a => `<option value="${a}">${a}</option>`).join('')}
            </select>
            <div id="filteredChartsMessage" style="margin-top:10px; font-style:italic;"></div>
        `;
        const detailedDiv = document.getElementById('detailedChartsSection');
        if (detailedDiv) detailedDiv.parentNode.insertBefore(filterDiv, detailedDiv);
        else container.appendChild(filterDiv);
        areaSelect = document.getElementById('businessAreaSelect');
    } else {
        areaSelect.innerHTML = '<option value="">-- All Areas (Overall) --</option>' + areasArray.map(a => `<option value="${a}">${a}</option>`).join('');
    }

    // Restore saved selection
    const savedArea = localStorage.getItem('selectedBusinessArea');
    if (savedArea && areasArray.includes(savedArea)) {
        areaSelect.value = savedArea;
    }

    // ---- Filtered charts (based on selected area) ----
    const selectedArea = areaSelect.value;
    if (selectedArea) {
        renderFilteredCharts(historicalData, selectedArea);
    } else {
        const msgDiv = document.getElementById('filteredChartsMessage');
        if (msgDiv) msgDiv.innerText = '';
        ['filteredEvChart','filteredRwChart','filteredCtChart','filteredAvgWorkloadChart','filteredResourceDistChart','filteredBugSeverityChart','filteredBugTypeChart'].forEach(id => {
            if (window[id+'Chart']) window[id+'Chart'].destroy();
        });
    }

    // ---- Summary table ----
    let tableHtml = `<table style="width:100%; border-collapse:collapse; background:white; border-radius:8px; overflow:hidden; box-shadow:0 2px 5px rgba(0,0,0,0.1);">
        <thead><tr style="background:#2c3e50; color:white;">
            <th style="padding:12px;">Iteration</th><th>Completed Stories</th><th>Avg Cycle (days)</th><th>Effort Var %</th><th>DRE %</th><th>Rework %</th><th>Dev Hrs</th><th>Test Hrs</th><th>Unique Resources</th>
            </tr></thead><tbody>`;
    historicalData.forEach(d => {
        tableHtml += `<tr style="border-bottom:1px solid #eee;">
            <td style="padding:10px;">${d.iterationName}</td>
            <td style="text-align:center;">${d.completedStories} / ${d.totalStories}</td>
            <td style="text-align:center;">${d.avgCycleTime}</td>
            <td style="text-align:center; color:${d.effortVariance > 15 ? '#e74c3c' : '#27ae60'};">${d.effortVariance}%</td>
            <td style="text-align:center; color:${d.dre < 85 ? '#e67e22' : '#27ae60'};">${d.dre}%</td>
            <td style="text-align:center; color:${d.reworkRatio > 15 ? '#e74c3c' : '#27ae60'};">${d.reworkRatio}%</td>
            <td style="text-align:center;">${d.totalDevActual || 0}</td>
            <td style="text-align:center;">${d.totalTestActual || 0}</td>
            <td style="text-align:center;">${d.uniqueResourcesCount || 0}</td>
           </tr>`;
    });
    tableHtml += `</tbody>table</div>`;
    let existingTable = document.getElementById('historicalSummaryTable');
    if (!existingTable) {
        existingTable = document.createElement('div');
        existingTable.id = 'historicalSummaryTable';
        container.appendChild(existingTable);
    }
    existingTable.innerHTML = tableHtml;

    // ---- Forecast (Overall) ----
    const overallForecastHtml = renderForecastWidgets(historicalData, null, "Overall");
    let forecastContainer = document.getElementById('forecastContainer');
    if (!forecastContainer) {
        forecastContainer = document.createElement('div');
        forecastContainer.id = 'forecastContainer';
        container.appendChild(forecastContainer);
    }
    forecastContainer.innerHTML = `
        <h3 style="color: #2c3e50; border-left: 6px solid #8e44ad; padding-left: 15px; margin: 30px 0 10px 0;">
            🔮 Iteration Completion Forecast (Monte Carlo)
        </h3>
        ${overallForecastHtml}
    `;

    // ---- Forecast per Business Area ----
    let areaForecastContainer = document.getElementById('areaForecastContainer');
    if (!areaForecastContainer) {
        areaForecastContainer = document.createElement('div');
        areaForecastContainer.id = 'areaForecastContainer';
        container.appendChild(areaForecastContainer);
    }
    if (areasArray.length > 0) {
        let areaHtml = `<h3 style="color: #2c3e50; border-left: 6px solid #2980b9; padding-left: 15px; margin: 40px 0 10px 0;">
                            📈 Forecast by Business Area
                        </h3>`;
        areasArray.forEach(area => {
            areaHtml += renderForecastWidgets(historicalData, area, "Business Area");
        });
        areaForecastContainer.innerHTML = areaHtml;
    } else {
        areaForecastContainer.innerHTML = '';
    }

    // ========== HEATMAP SECTION ==========
    
    let heatmapContainer = document.getElementById('heatmapContainer');
    if (!heatmapContainer) {
        heatmapContainer = document.createElement('div');
        heatmapContainer.id = 'heatmapContainer';
        heatmapContainer.style.margin = '40px 0 20px 0';
        container.appendChild(heatmapContainer);
    }

    // Build heatmap data based on selected area (or overall)
    let heatmapData = [];
    const areaForHeatmap = document.getElementById('businessAreaSelect')?.value || '';
    if (areaForHeatmap) {
        // Use business area specific metrics
        historicalData.forEach(iter => {
            const ba = iter.businessMetrics?.find(b => b.area === areaForHeatmap);
            if (ba) {
                heatmapData.push({
                    iteration: iter.iterationName,
                    CT: ba.avgCycleTime || 0,
                    RW: ba.reworkRatio || 0,
                    EV: ba.effortVariance || 0,    // القيمة الأصلية للعرض
                    Bugs: ba.internalBugs || 0
                });
            }
        });
    } else {
        // Use overall metrics
        heatmapData = historicalData.map(iter => ({
            iteration: iter.iterationName,
            CT: iter.avgCycleTime || 0,
            RW: iter.reworkRatio || 0,
            EV: iter.effortVariance || 0,       // القيمة الأصلية للعرض
            Bugs: iter.internalBugs || 0
        }));
    }

    // ====== الحل الجديد: حساب الألوان يدوياً مع معالجة خاصة لـ EV ======
    let heatmapHtml = `<h3 style="color: #2c3e50; border-left: 6px solid #e74c3c; padding-left: 15px; margin-top: 10px;">🔥 Heatmap of Key Metrics ${areaForHeatmap ? `(${areaForHeatmap})` : '(Overall)'}</h3>`;
    
    if (heatmapData.length > 0) {
        // 1. حساب المدى (Min/Max) لكل مقياس
        // ولكن بالنسبة لـ EV، سنحسب المدى على أساس "القيمة المطلقة" (Abs)
        const allCT = heatmapData.map(d => d.CT);
        const allRW = heatmapData.map(d => d.RW);
        const allEV = heatmapData.map(d => d.EV);
        const allBugs = heatmapData.map(d => d.Bugs);
        
        // حساب القيم المطلقة لـ EV لإيجاد المدى
        const allAbsEV = allEV.map(v => Math.abs(v));
        const minEV = Math.min(...allAbsEV);
        const maxEV = Math.max(...allAbsEV);
        
        const minCT = Math.min(...allCT);
        const maxCT = Math.max(...allCT);
        const minRW = Math.min(...allRW);
        const maxRW = Math.max(...allRW);
        const minBugs = Math.min(...allBugs);
        const maxBugs = Math.max(...allBugs);

        // دالة مساعدة لتوليد اللون (تُستخدم لكل المقاييس ما عدا EV)
        const getColor = (value, min, max) => {
            if (max === min) return '#2ecc71'; // لون محايد أخضر
            // منع القيم السالبة من كسر النسبة (للمقاييس الأخرى التي قد تكون سالبة نظرياً)
            const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
            const r = Math.round(255 * ratio);
            const g = Math.round(255 * (1 - ratio));
            return `rgb(${r}, ${g}, 80)`;
        };

        // دالة خاصة لتوليد لون EV بناءً على القيمة المطلقة (Abs)
        const getEVColor = (value) => {
            const absVal = Math.abs(value);
            if (maxEV === minEV) return '#2ecc71';
            // النسبة: كلما زادت القيمة المطلقة، زادت النسبة (أحمر)
            const ratio = Math.max(0, Math.min(1, (absVal - minEV) / (maxEV - minEV)));
            const r = Math.round(255 * ratio);
            const g = Math.round(255 * (1 - ratio));
            return `rgb(${r}, ${g}, 80)`;
        };

        // بداية بناء الجدول
        let tableHtml = `
        <div style="overflow-x:auto; margin-top:20px;">
            <table style="width:100%; border-collapse:collapse; font-size:0.95em; box-shadow:0 2px 8px rgba(0,0,0,0.1); border-radius:8px; overflow:hidden;">
                <thead>
                    <tr style="background:#2c3e50; color:white;">
                        <th style="padding:12px; text-align:center;">Iteration</th>
                        <th style="padding:12px; text-align:center;">CT (Cycle Time)</th>
                        <th style="padding:12px; text-align:center;">RW (Rework %)</th>
                        <th style="padding:12px; text-align:center;">EV (Effort Variance %)</th>
                        <th style="padding:12px; text-align:center;">Bugs (Count)</th>
                    </tr>
                </thead>
                <tbody>`;

        heatmapData.forEach(row => {
            const ctColor = getColor(row.CT, minCT, maxCT);
            const rwColor = getColor(row.RW, minRW, maxRW);
            const evColor = getEVColor(row.EV);
            const bugsColor = getColor(row.Bugs, minBugs, maxBugs);

            // تحديد لون النص بناءً على شدة اللون (تحسين القراءة)
            const getTextColor = (val, min, max) => {
                if (max === min) return '#2c3e50';
                const ratio = (val - min) / (max - min);
                return ratio > 0.5 ? 'white' : '#2c3e50';
            };
            const getEVTextColor = (val) => {
                const absVal = Math.abs(val);
                if (maxEV === minEV) return '#2c3e50';
                const ratio = (absVal - minEV) / (maxEV - minEV);
                return ratio > 0.5 ? 'white' : '#2c3e50';
            };

            tableHtml += `<tr>`;
            tableHtml += `<td style="padding:12px; text-align:center; font-weight:600; background:#f8f9fa;">${row.iteration}</td>`;
            tableHtml += `<td style="padding:12px; text-align:center; background-color:${ctColor}; color:${getTextColor(row.CT, minCT, maxCT)}; font-weight:bold; cursor:help;" title="CT: ${row.CT.toFixed(1)} days">${row.CT.toFixed(1)}</td>`;
            tableHtml += `<td style="padding:12px; text-align:center; background-color:${rwColor}; color:${getTextColor(row.RW, minRW, maxRW)}; font-weight:bold; cursor:help;" title="RW: ${row.RW.toFixed(1)}%">${row.RW.toFixed(1)}%</td>`;
            // عمود EV باستخدام الدالة الخاصة
            tableHtml += `<td style="padding:12px; text-align:center; background-color:${evColor}; color:${getEVTextColor(row.EV)}; font-weight:bold; cursor:help;" title="EV: ${row.EV.toFixed(1)}% (Closer to 0 is better)">${row.EV.toFixed(1)}%</td>`;
            tableHtml += `<td style="padding:12px; text-align:center; background-color:${bugsColor}; color:${getTextColor(row.Bugs, minBugs, maxBugs)}; font-weight:bold; cursor:help;" title="Bugs: ${row.Bugs}">${row.Bugs}</td>`;
            tableHtml += `</tr>`;
        });

        tableHtml += `</tbody>table</div>`;
        heatmapHtml += tableHtml;
    } else {
        heatmapHtml += `<p style="color: #7f8c8d;">No data available for the selected area.</p>`;
    }
    heatmapContainer.innerHTML = heatmapHtml;
}
// ==================== UPDATED onBusinessAreaChange ====================
window.onBusinessAreaChange = function() {
    const select = document.getElementById('businessAreaSelect');
    const selected = select.value;
    localStorage.setItem('selectedBusinessArea', selected);
    // Re-render everything (including heatmap) with the new filter
    renderHistoricalAnalyticsView();
};

// Helper functions for historical sync (duplicate from main but safe)
function buildStoriesFromRawDataForHistory(data) {
    const stories = [];
    let currentStory = null;
    data.forEach(row => {
        const type = row['Work Item Type'];
        if (type === 'User Story') {
            currentStory = {
                id: row['ID'],
                title: row['Title'],
                businessArea: row['Business Area'] || 'General',
                devLead: row['Assigned To'],
                testerLead: row['Assigned To Tester'],
                testedDate: row['Tested Date'],
                activatedDate: row['Activated Date'],
                status: row['State'],
                tasks: [],
                bugs: [],
                reviews: []
            };
            stories.push(currentStory);
        } else if (currentStory) {
            if (type === 'Task') currentStory.tasks.push(row);
            if (type === 'Bug') currentStory.bugs.push(row);
            if (type === 'Review') currentStory.reviews.push(row);
        }
    });
    return stories;
}

function calculateMetricsForStoriesForHistory(stories) {
    stories.forEach(us => {
        let devOrig = 0, devActual = 0, testOrig = 0, testActual = 0;
        let dbOrig = 0, dbActual = 0, dbNames = new Set();
        us.tasks.forEach(t => {
            const orig = parseFloat(t['Original Estimation']) || 0;
            const actDev = parseFloat(t['TimeSheet_DevActualTime']) || 0; 
            const actTest = parseFloat(t['TimeSheet_TestingActualTime']) || 0;
            const activity = t['Activity'];
            if (activity === 'DB Modification') {
                dbOrig += orig;
                dbActual += actDev; 
                if (t['Assigned To']) dbNames.add(t['Assigned To']);
            } else if (activity === 'Development') {
                devOrig += orig;
                devActual += actDev;
            } else if (activity === 'Testing') {
                testOrig += orig;
                testActual += actTest;
            }
        });
        us.dbEffort = { orig: dbOrig, actual: dbActual, dev: dbOrig / (dbActual || 1), names: Array.from(dbNames).join(', ') || 'N/A' };
        us.devEffort = { orig: devOrig, actual: devActual, dev: devOrig / (devActual || 1) };
        us.testEffort = { orig: testOrig, actual: testActual, dev: testOrig / (testActual || 1) };

        let bugOrig = 0, bugActualTotal = 0, bugsNoTimesheet = 0;
        us.severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
        us.rework = {
            generic: { count: 0, actualTime: 0, severity: { critical: 0, high: 0, medium: 0, low: 0 } },
            specific: { count: 0, actualTime: 0, severity: { critical: 0, high: 0, medium: 0, low: 0 } },
            severity: { critical: 0, high: 0, medium: 0, low: 0 }, 
            timeEstimation: 0,
            actualTime: 0,
            count: 0,
            uatBugsCount: 0,
            iterationBugsCount: 0
        };
        us.bugs.forEach(b => {
            const isGeneric = (b['GenericBug'] || "").trim().toLowerCase() === 'yes';
            const bDevAct = parseFloat(b['TimeSheet_DevActualTime']) || 0;
            const bEst = parseFloat(b['Original Estimation']) || 0;
            const sev = b['Severity'] || "";
            const bugType = (b['BugType'] || "").trim().toUpperCase();
            if (bugType === 'UAT') us.rework.uatBugsCount++;
            else us.rework.iterationBugsCount++;
            bugOrig += bEst;
            bugActualTotal += bDevAct;
            if (bDevAct === 0) bugsNoTimesheet++;
            const target = isGeneric ? us.rework.generic : us.rework.specific;
            target.count++;
            target.actualTime += bDevAct;
            if (sev.includes("1 - Critical")) { 
                target.severity.critical++; us.rework.severity.critical++; us.severityCounts.critical++;
            } else if (sev.includes("2 - High")) { 
                target.severity.high++; us.rework.severity.high++; us.severityCounts.high++;
            } else if (sev.includes("3 - Medium")) { 
                target.severity.medium++; us.rework.severity.medium++; us.severityCounts.medium++;
            } else if (sev.includes("4 - Low")) { 
                target.severity.low++; us.rework.severity.low++; us.severityCounts.low++;
            }
        });
        us.rework.timeEstimation = bugOrig;
        us.rework.actualTime = bugActualTotal;
        us.rework.count = us.bugs.length;
        us.rework.missingTimesheet = bugsNoTimesheet;
        us.rework.deviation = bugOrig / (bugActualTotal || 1);
        us.rework.percentage = (bugActualTotal / (us.devEffort.actual || 1)) * 100;
        
        us.reviewStats = {
            estimation: 0, devActual: 0, testActual: 0, totalActual: 0,
            devCount: 0, testCount: 0, count: us.reviews ? us.reviews.length : 0,
            severity: { critical: 0, high: 0, medium: 0, low: 0}
        };
        if (us.reviews) {
            us.reviews.forEach(r => {
                const rEst = parseFloat(r['Original Estimation']) || 0;
                const rDevAct = parseFloat(r['TimeSheet_DevActualTime']) || 0;
                const rTestAct = parseFloat(r['TimeSheet_TestingActualTime']) || 0;
                const activity = r['Activity'];
                const sev = r['Severity'] || "";
                us.reviewStats.estimation += rEst;
                if (activity === 'Development') {
                    us.reviewStats.devActual += rDevAct;
                    us.reviewStats.devCount++;
                } else if (activity === 'Testing') {
                    us.reviewStats.testActual += rTestAct;
                    us.reviewStats.testCount++;
                }
                if (sev.includes("1 - Critical")) us.reviewStats.severity.critical++;
                else if (sev.includes("2 - High")) us.reviewStats.severity.high++;
                else if (sev.includes("3 - Medium")) us.reviewStats.severity.medium++;
                else if (sev.includes("4 - Low")) us.reviewStats.severity.low++;
            });
            us.reviewStats.totalActual = us.reviewStats.devActual + us.reviewStats.testActual;
        }
        let minDate = Infinity;
        us.tasks.forEach(t => {
            const taskDate = new Date(t['Activated Date']).getTime();
            if (!isNaN(taskDate) && taskDate < minDate) minDate = taskDate;
        });
        const firstTaskStart = minDate === Infinity ? null : new Date(minDate);
        const storyEndDate = us.testedDate ? new Date(us.testedDate) : null;
        us.cycleTime = calculateCycleTimeDays(firstTaskStart, storyEndDate);
        calculateTimeline(us);
    });
}

function renderAzureConfigsTable() {
    const tbody = document.getElementById('azureConfigsTableBody');
    if (!tbody) return;
    const savedQueries = azureConfigs || [];
    if (savedQueries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No queries found in cloud configuration.</td></tr>';
        return;
    }
    tbody.innerHTML = savedQueries.map((config, index) => `
        <tr>
            <td>${config.name || 'N/A'}</td>
            <td>${config.org || 'N/A'} / ${config.project || 'N/A'}</td>
            <td>${config.id || 'N/A'}</td>
            <td><button onclick="deleteAzureConfig(${index})" style="background:#e74c3c; padding:5px 10px; color:white; border:none; border-radius:3px; cursor:pointer;">Delete</button></td>
        </tr>
    `).join('');
}

async function addAzureConfig() {
    const config = {
        id: document.getElementById('azQueryId').value,
        name: document.getElementById('azQueryName').value,
        org: document.getElementById('azOrg').value,
        project: document.getElementById('azProject').value
    };
    if (!config.id || !config.name) return alert("Please fill all fields");
    try {
        await loadConfigsFromCloud();
        const updatedConfigs = [...azureConfigs, config];
        const updateResponse = await fetch(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/azure_configs.json`, {
            method: 'PUT',
            headers: { 'Authorization': `token ${githubToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: "Add Azure Config", content: btoa(unescape(encodeURIComponent(JSON.stringify(updatedConfigs, null, 2)))), sha: azureConfigsSha })
        });
        if (updateResponse.ok) {
            alert("Saved successfully!");
            await loadConfigsFromCloud();
        } else throw new Error("Failed to update GitHub");
    } catch (error) {
        alert("Error saving: " + error.message);
    }
}

async function deleteAzureConfig(index) {
    if (!confirm("Delete this configuration from cloud?")) return;
    try {
        const updatedConfigs = [...azureConfigs];
        updatedConfigs.splice(index, 1);
        const updateResponse = await fetch(`https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/azure_configs.json`, {
            method: 'PUT',
            headers: { 'Authorization': `token ${githubToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: "Delete Azure Config", content: btoa(unescape(encodeURIComponent(JSON.stringify(updatedConfigs, null, 2)))), sha: azureConfigsSha })
        });
        if (updateResponse.ok) {
            alert("Deleted successfully");
            await loadConfigsFromCloud();
        } else throw new Error("Failed to update GitHub");
    } catch (error) {
        alert("Error deleting: " + error.message);
    }
}

function addHoliday() {
    const picker = document.getElementById('holidayPicker');
    if (!picker.value) return;
    const date = picker.value;
    if (!holidays.includes(date)) {
        holidays.push(date);
        localStorage.setItem('holidays', JSON.stringify(holidays));
        renderHolidaysList();
        processData(); // re-calc timelines
        renderIterationView(); // refresh if visible
    }
    picker.value = '';
}

function renderHolidaysList() {
    const list = document.getElementById('holidaysList');
    if (!list) return;
    list.innerHTML = holidays.map(d => `<li>${d} <button onclick="removeHoliday('${d}')">Remove</button></li>`).join('');
}

function removeHoliday(date) {
    holidays = holidays.filter(d => d !== date);
    localStorage.setItem('holidays', JSON.stringify(holidays));
    renderHolidaysList();
    processData();
    renderIterationView();
}

function renderForecastWidgets(historicalData, area = null, title = "Overall") {
    // استخراج البيانات الخاصة بالمنطقة أو الكل
    let cycleTimes = [];
    let completedStories = [];
    let reworkRatios = [];      // نسبة الريورك (مئوية)
    let reworkHours = [];       // ساعات الريورك الفعلية (للعرض الصغير)

    historicalData.forEach(iter => {
        let metrics;
        if (area) {
            // البحث عن المنطقة في businessMetrics
            const found = iter.businessMetrics && iter.businessMetrics.find(b => b.area === area);
            if (!found) return;
            metrics = found;
        } else {
            // استخدام الإحصائيات الكلية
            metrics = iter;
        }

        // استخراج القيم
        const ct = metrics.avgCycleTime;
        const cs = metrics.completedStories;
        // الريورك: نسبة (reworkRatio) + الساعات الفعلية
        const rwRatio = metrics.reworkRatio;          // نسبة مئوية
        const rwHours = metrics.totalBugActual || 0;  // ساعات

        if (ct !== undefined && ct > 0) cycleTimes.push(ct);
        if (cs !== undefined && cs > 0) completedStories.push(cs);
        if (rwRatio !== undefined && rwRatio > 0) {
            reworkRatios.push(rwRatio);
            reworkHours.push(rwHours);
        }
    });

    // التحقق من وجود بيانات كافية
    if (cycleTimes.length < 2 || completedStories.length < 2 || reworkRatios.length < 2) {
        return `<div class="card" style="padding: 20px; margin: 20px 0;">
            <p style="color: #e67e22;">⚠️ Not enough historical data for "${title}" (need at least 2 iterations with complete metrics).</p>
        </div>`;
    }

    const NUM_SIM = 5000;
    const ctSims = runBootstrap(cycleTimes, NUM_SIM);
    const csSims = runBootstrap(completedStories, NUM_SIM);
    const rrSims = runBootstrap(reworkRatios, NUM_SIM);
    // بالنسبة للساعات نستخدم متوسط الساعات الفعلية (لا حاجة لمحاكاة منفصلة، نأخذ الوسيط)
    const rhMedian = reworkHours.reduce((a,b) => a+b, 0) / reworkHours.length;

    const ct = getPercentiles(ctSims);
    const cs = getPercentiles(csSims);
    const rr = getPercentiles(rrSims);

    // إعداد النص الخاص بالمنطقة
    const areaLabel = area ? ` (${area})` : '';

    return `
        <div style="margin: 30px 0 15px 0;">
            <h4 style="color: #2c3e50; border-left: 4px solid #8e44ad; padding-left: 12px;">📊 ${title} ${areaLabel}</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 20px;">
                <!-- Cycle Time -->
                <div class="card" style="padding: 18px; border-top: 5px solid #3498db; background: #f8fcff;">
                    <div style="font-size: 0.9em; color: #7f8c8d;">⏱️ Forecast Cycle Time</div>
                    <div style="font-size: 2em; font-weight: bold; color: #2980b9;">${ct.median.toFixed(1)} <small style="font-size: 0.4em; color: #7f8c8d;">days</small></div>
                    <div style="color: #7f8c8d; font-size: 0.85em;">Range: ${ct.low.toFixed(1)} – ${ct.high.toFixed(1)} days</div>
                    <div style="font-size: 0.75em; color: #95a5a6;">Based on ${cycleTimes.length} iterations</div>
                </div>

                <!-- Completed Stories -->
                <div class="card" style="padding: 18px; border-top: 5px solid #27ae60; background: #f4fcf7;">
                    <div style="font-size: 0.9em; color: #7f8c8d;">📊 Forecast Completed Stories</div>
                    <div style="font-size: 2em; font-weight: bold; color: #27ae60;">${cs.median.toFixed(0)} <small style="font-size: 0.4em; color: #7f8c8d;">stories</small></div>
                    <div style="color: #7f8c8d; font-size: 0.85em;">Range: ${cs.low.toFixed(0)} – ${cs.high.toFixed(0)} stories</div>
                    <div style="font-size: 0.75em; color: #95a5a6;">Based on ${completedStories.length} iterations</div>
                </div>

                <!-- Rework Ratio + Hours -->
                <div class="card" style="padding: 18px; border-top: 5px solid #e67e22; background: #fef9f4;">
                    <div style="font-size: 0.9em; color: #7f8c8d;">🔄 Forecast Rework</div>
                    <div style="font-size: 2em; font-weight: bold; color: #e67e22;">${rr.median.toFixed(1)}% <small style="font-size: 0.4em; color: #7f8c8d;">ratio</small></div>
                    <div style="color: #7f8c8d; font-size: 0.85em;">
                        Range: ${rr.low.toFixed(1)}% – ${rr.high.toFixed(1)}% 
                        <span style="font-size: 0.8em; color: #95a5a6;">(${rhMedian.toFixed(1)} hrs avg)</span>
                    </div>
                    <div style="font-size: 0.75em; color: #95a5a6;">Based on ${reworkRatios.length} iterations</div>
                </div>
            </div>
        </div>
    `;
}
// ========== Monte Carlo Forecasting Helpers ==========

function runBootstrap(data, numSimulations = 10000) {
    if (!data || data.length === 0) return [];
    const sims = [];
    const n = data.length;
    for (let i = 0; i < numSimulations; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
            const idx = Math.floor(Math.random() * n);
            sum += data[idx];
        }
        sims.push(sum / n);
    }
    return sims;
}

function getPercentile(sorted, p) {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function getPercentiles(arr, lowP = 10, highP = 90) {
    if (!arr || arr.length === 0) return { median: 0, low: 0, high: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const median = getPercentile(sorted, 50);
    const low = getPercentile(sorted, lowP);
    const high = getPercentile(sorted, highP);
    return { median, low, high };
}

// ==================== View Switching ====================
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const target = document.getElementById(viewId);
    if (target) target.style.display = 'block';
    if (processedStories.length === 0 && viewId !== 'historical-analytics-view') return;
    if (viewId === 'iteration-view') renderIterationView();
    if (viewId === 'business-view') renderBusinessView();
    if (viewId === 'team-view') renderTeamView();
    if (viewId === 'people-view') renderPeopleView();
    if (viewId === 'not-tested-view') renderNotTestedView();
    if (viewId === 'users-view') renderUsersTable();
    if (viewId === 'holidays-view') renderHolidaysList();
    if (viewId === 'historical-analytics-view') renderHistoricalAnalyticsView();
}


// ==================== Initialization ====================
window.onload = async () => {
    const savedUser = localStorage.getItem('saved_user');
    const savedPass = localStorage.getItem('saved_pass');
    const savedGhToken = localStorage.getItem('gh_token');
    const savedAzurePat = localStorage.getItem('azure_pat');
    const savedRole = localStorage.getItem('app_role');
    if (savedUser) document.getElementById('loginUser').value = savedUser;
    if (savedPass) document.getElementById('loginPass').value = savedPass;
    if (savedGhToken) document.getElementById('ghTokenInput').value = savedGhToken;
    if (savedAzurePat) document.getElementById('azurePatInput').value = savedAzurePat;
    if (savedGhToken && savedRole && savedUser) {
        githubToken = savedGhToken;
        document.getElementById('login-overlay').style.display = 'none';
        if (document.getElementById('main-nav')) document.getElementById('main-nav').style.display = 'flex';
        currentUser = { name: savedUser, role: savedRole };
        setupPermissions();
        await fetchDataFromGitHub();
    }
    if (typeof renderAzureConfigsTable === 'function') renderAzureConfigsTable();
    renderHolidaysList();
};
