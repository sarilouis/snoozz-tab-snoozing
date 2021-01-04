const TIME_GROUPS = ['Today', 'Tomorrow', 'This Week', 'Next Week', 'Later', 'History'];
var HISTORY = -1, CACHED_TABS, ticktock;
async function init() {
	document.querySelector('.settings').onkeyup = e => {if (e.which === 13) openExtensionTab('/html/settings.html')}
	document.querySelector('.settings').addEventListener('click', _ => openExtensionTab('/html/settings.html'), {once:true})
	showIconOnScroll();
	setupClock();

	// refresh dashboard when storage changed if page is not in focus
	chrome.storage.onChanged.addListener(async changes => {
		if (changes.snoozed) CACHED_TABS = changes.snoozed.newValue;
		if (!document.hasFocus() || document.hidden) fillTimeGroups();
	});

	chrome.runtime.onMessage.addListener(async msg => {
		if (msg.updateDash) {
			var tabs = await getSnoozedTabs();
			CACHED_TABS = tabs;
			fillTimeGroups();
		}
	});
	document.addEventListener('visibilitychange', _ => {setupClock();fillTimeGroups()});
	var search = document.getElementById('search');
	search.addEventListener('input', _ => {
		search.parentElement.classList.toggle('searching', search.value.length > 0);
		search.parentElement.parentElement.classList.toggle('valid-search', search.value.length > 2);
		fillTimeGroups(search.value.toLowerCase());
	})

	CACHED_TABS = await getSnoozedTabs();
	HISTORY = await getOptions('history');

	buildTimeGroups();
	fillTimeGroups();

	if (getBrowser() === 'safari') await chrome.runtime.getBackgroundPage(async bg => {await bg.wakeUpTask()});
}

function setupClock() {
	if (ticktock) clearTimeout(ticktock);
	var NOW = dayjs();
	var currentSecond = parseInt(NOW.second());
	var currentMin = parseInt(NOW.minute());
	var currentHour = parseInt(NOW.hour());
	var rotate = num => `rotate(${num}deg)`;

	document.querySelector('.second').style.transform = rotate(currentSecond * 6);
	document.querySelector('.minute').style.transform = rotate(currentMin * 6);
	document.querySelector('.hour').style.transform = rotate(180 + ((currentHour % 12) * 30));

	moveSecondHand = _ => {
		clearTimeout(ticktock);
		document.querySelector('.second').style.transform = rotate((++currentSecond) * 6);
		if (currentSecond % 60 === 0) document.querySelector('.minute').style.transform = rotate((++currentMin) * 6);
		if (currentMin % 60 === 0 && currentSecond % 60 === 0) document.querySelector('.hour').style.transform = rotate(180 + (((++currentHour) % 12) * 30));
		ticktock = setTimeout(moveSecondHand, 1000)
	}
	ticktock = setTimeout(moveSecondHand, 1000);
}

function buildTimeGroups() {
	var container = document.getElementById('time-container');
	
	TIME_GROUPS.forEach(t => {
		var tID = t.replace(/ /g,'_').toLowerCase();
		var timeGroup = Object.assign(document.createElement('div'), {className: 'time-group', id: tID});
		var header = Object.assign(document.createElement('div'), {className: 'flex time-header'});
		var name = Object.assign(document.createElement('h2'), {className: 'time-name', innerText: t});
		var timeAction = Object.assign(document.createElement('div'), {
			className: `time-action`,
			tabIndex: 0,
			innerText: tID === 'history' ? 'clear history' : 'wake up all'
		});
		timeAction.onclick = async _ => {
			var ids = Array.from(document.querySelectorAll(`#${tID} .tab`)).map(t =>t.id);
			tID === 'history' ? await removeTabsFromHistory(ids) : await wakeUpTabsAbruptly(ids);
		}
		timeAction.onkeyup = async e => {
			if (e.which !== 13) return;
			var ids = Array.from(document.querySelectorAll(`#${tID} .tab`)).map(t =>t.id);
			tID === 'history' ? await removeTabsFromHistory(ids) : await wakeUpTabsAbruptly(ids);
		}
		header.append(name, timeAction);
		timeGroup.append(header);
		container.append(timeGroup);
	});
}

function updateTimeGroups() {
	TIME_GROUPS.forEach(name => {
		var tg = document.getElementById(name.replace(/ /g,"_").toLowerCase())
		var tabCount = Array.from(tg.querySelectorAll('.tab')).length
		tg.classList.toggle('hidden', tabCount === 0)
		tg.querySelector('.time-action').classList.toggle('hidden', tabCount < 2);
	})
	document.getElementById('no-tabs').classList.toggle('hidden', document.querySelector('.tab'));
}

function matchQuery(query, against) {
	var array = typeof against === 'string' ? against.toLowerCase().trim().split(' ') : against;
	for (word of query.trim().split(" ")) {
		if (!array.some(a => a.indexOf(word.toLowerCase()) > -1)) return false;
	}
	return true;
}

function search(t, query) {
	// tab props
	if (t.url && t.url.toLowerCase().indexOf(query) > -1) return true;
	if (t.title && t.title.toLowerCase().indexOf(query) > -1) return true;
	// relative time
	if (!t.opened && ('snoozed sleeping asleep napping snoozzed snoozing snoozzing').indexOf(query) > -1) return true;
	if (t.opened && ('manually deleted removed reopened awake history').indexOf(query) > -1) return true;
	// categories
	if (matchQuery(query, getTimeGroup('wakeUpTime', t, true).map(tg => tg.replace(/_/g, ' ')))) return true;
	if (matchQuery(query, getTimeGroup('timeCreated', t, true).map(tg => tg.replace(/_/g, ' ')))) return true;
	// absolute time
	if ( t.opened && matchQuery(query, dayjs(t.opened).format('dddd DD MMMM A'))) return true;
	if (!t.opened && t.wakeUpTime && matchQuery(query, dayjs(t.wakeUpTime).format('dddd DD MMMM A'))) return true;
	if ( t.timeCreated && matchQuery(query, dayjs(t.timeCreated).format('dddd DD MMMM A'))) return true;
	return false;
}

function fillTimeGroups(searchQuery = '') {
	var tabs = CACHED_TABS || [];
	document.querySelectorAll('#time-container p, #time-container .tab').forEach(el => el.remove());
	document.querySelector('.search-container').classList.toggle('hidden', tabs.length < 2);
	document.querySelector('.instructions').classList.toggle('hidden', tabs.length > 0);

	if (searchQuery.length > 2) tabs = tabs.filter(t => search(t, searchQuery) || (t.tabs && t.tabs.some(tt => search(tt, searchQuery))));

	var s = sleeping(tabs);
	if (s.length > 0) s.sort((t1,t2) => t1.wakeUpTime - t2.wakeUpTime).forEach(f => {
		var timeGroup = document.getElementById(getTimeGroup('wakeUpTime', f));
		if (timeGroup) timeGroup.append(buildTab(f));
	})

	var a = tabs.filter(t => t.opened);
	if (a.length > 0) {
		a.sort((t1,t2) => t2.opened - t1.opened).forEach(h => document.getElementById(getTimeGroup('wakeUpTime', h)).append(buildTab(h)))	
		var historyHref = Object.assign(document.createElement('a'), {href: "./settings.html#history", innerText: `${HISTORY} day${HISTORY>1?'s':''}`});
		var msg = document.createElement('p');
		msg.append('Tabs in your Snoozz history are removed ', historyHref, ' after they wake up.');
		document.getElementById('history').appendChild(msg);
	}
	document.getElementById('api-message').classList.toggle('hidden', s.length === 0 && a.length === 0)
	updateTimeGroups();
}

function buildTab(t) {
	var tab = wrapInDiv({className:`tab${t.tabs ? ' window collapsed':''}`, id: t.id});

	var icon = Object.assign(document.createElement('img'), {
		className: `icon ${t.tabs ? 'dropdown':''}`,
		src: getIconForTab(t),
		tabIndex: t.tabs ? 0 : -1,
	});
	icon.onerror = _ => icon.src = '../icons/unknown.png';
	var iconContainer = wrapInDiv('icon-container', icon);

	var title = wrapInDiv({className: 'tab-name', innerText: t.title, title: t.url ?? '', tabIndex: t.tabs ? -1 : 0})
	if (t.opened && !t.tabs) {
		title.onclick = _ => openTab(t);
		title.onkeyup = e => { if (e.which === 13) openTab(t)};
	}
	var startedNap = Object.assign(document.createElement('div'), {
		className: 'nap-time',
		innerText: `Started napping at ${dayjs(t.timeCreated).format('h:mm a [on] ddd D MMM YYYY')}`,
	});
	var titleContainer = wrapInDiv('title-container', title, startedNap);

	var wakeUpLabel = Object.assign(document.createElement('div'), {
		className: 'wakeup-label',
		innerText: t.deleted ? 'Deleted on' : (t.opened ? `Woke up ${t.opened < t.wakeUpTime ? 'manually' : 'automatically'} on` : 'Waking up')
	});
	var wakeUpTime = Object.assign(document.createElement('div'), {
		className: 'wakeup-time',
		innerText: t.opened ? dayjs(t.opened).format('dddd, D MMM') : formatSnoozedUntil(t.wakeUpTime),
		title: dayjs(t.opened ? t.opened : t.wakeUpTime).format('h:mm a [on] ddd, D MMMM YYYY')
	});
	var wakeUpTimeContainer = wrapInDiv('wakeup-time-container', wakeUpLabel, wakeUpTime);

	var littleTabs = '';
	if (t.tabs && t.tabs.length) {
		littleTabs = wrapInDiv('tabs');
		t.tabs.forEach(lt => {
			var littleIcon = Object.assign(document.createElement('img'), {className: 'little-icon', src: getIconForTab(lt)});
			littleIcon.onerror = _ => littleIcon.src = '../icons/unknown.png';
			var littleTitle = wrapInDiv({className: 'tab-name', innerText: lt.title});
			var littleTab = wrapInDiv({className: 'little-tab', tabIndex: 0}, littleIcon, littleTitle);
			littleTab.onclick = _ => openTab(lt);
			littleTab.onkeyup = e => {if (e.which === 13) openTab(lt)};
			littleTabs.append(littleTab);
		});

		[iconContainer, titleContainer].forEach(c => c.addEventListener('click', _ => tab.classList.toggle('collapsed')))
		iconContainer.onkeyup = e => {if (e.which === 13) tab.classList.toggle('collapsed')}
	}

	var wakeUpBtn = t.opened ? '' : Object.assign(document.createElement('img'), {className:'wakeup-button', src: '../icons/sun.png', tabIndex: 0});
	wakeUpBtn.onclick = async _ => await wakeUpTabsAbruptly([t.id]);
	wakeUpBtn.onkeyup = async e => {if (e.which === 13) await wakeUpTabsAbruptly([t.id])}
	var wakeUpBtnContainer = wrapInDiv('wakeup-btn-container tooltip', wakeUpBtn)

	var removeBtn = Object.assign(document.createElement('img'), {className:'remove-button', src: '../icons/close.svg',title: 'Delete', tabIndex: 0});
	removeBtn.onclick = async _ => t.opened ? await removeTabsFromHistory([t.id]) : await sendTabsToHistory([t.id]);
	removeBtn.onkeyup = async e => {if (e.which === 13) {t.opened ? await removeTabsFromHistory([t.id]) : await sendTabsToHistory([t.id])}}
	var removeBtnContainer = wrapInDiv('remove-btn-container tooltip', removeBtn)

	tab.append(iconContainer, titleContainer, wakeUpTimeContainer, wakeUpBtnContainer, removeBtnContainer, littleTabs);
	return tab;
}

var getIconForTab = t => t.tabs && t.tabs.length ? '../icons/dropdown.svg': (t.favicon && t.favicon !== '' ? t.favicon : getFaviconUrl(t.url));

function formatSnoozedUntil(ts) {
	var date = dayjs(ts);
	if (date.dayOfYear() === dayjs().dayOfYear()) return (date.hour() > 17 ? 'Tonight' : 'Today') + date.format(' [@] h:mm a');
	if (date.dayOfYear() === dayjs().add(1,'d').dayOfYear()) return 'Tomorrow' + date.format(' [@] h:mm a');
	if (date.week() === dayjs().week()) return date.format('ddd [@] h:mm a');
	return date.format('ddd, MMM D [@] h:mm a');
}

function getTimeGroup(timeType, tab, searchQuery = false) {
	if (!searchQuery && tab.opened) return 'history';

	var group = [];
	if (!tab.opened && !tab[timeType]) return group;
	var now = dayjs(), time = searchQuery && tab.opened ? dayjs(tab.opened) : dayjs(tab[timeType]);
	if (time.week() === now.subtract(1, 'week').week()) 		group.push('last_week');
	if (time.dayOfYear() === now.subtract(1, 'd').dayOfYear()) 	group.push('yesterday');
	if (time.dayOfYear() === now.dayOfYear()) 					group.push('today');
	if (time.dayOfYear() === now.add(1, 'd').dayOfYear()) 		group.push('tomorrow');
	if (time.week() === now.week()) 							group.push('this_week');
	if (time.week() === now.add(1, 'week').week()) 				group.push('next_week');
	if (time.valueOf() > now.add(1, 'week').valueOf())			group.push('later');
	return searchQuery ? group : group[0];
}

async function wakeUpTabsAbruptly(ids) {
	if (!ids) return;
	var tabs = CACHED_TABS;
	tabs.filter(t => ids.includes(t.id)).forEach(t => t.opened = dayjs().valueOf())
	chrome.runtime.sendMessage({logOptions: ['manually', ids]});
	await saveTabs(tabs);
	for (var t of tabs.filter(n => ids.includes(n.id))) t.tabs && t.tabs.length ? await openWindow(t) : await openTab(t);
	CACHED_TABS = tabs;
	fillTimeGroups();
}

async function sendTabsToHistory(ids) {
	if (!ids) return;
	var tabs = CACHED_TABS;
	tabs.filter(t => ids.includes(t.id)).forEach(t => {
		t.opened = dayjs().valueOf();
		t.deleted = true;
	});
	chrome.runtime.sendMessage({logOptions: ['history', ids]});
	await saveTabs(tabs);
	CACHED_TABS = tabs;
	fillTimeGroups();
}

debugMode = pretty => document.querySelectorAll('.tab').forEach(t => t.onclick = async _ => console.log(pretty ? await getPrettyTab(t.id) : await getSnoozedTabs([t.id])));

async function removeTabsFromHistory(ids) {
	if (!ids || (ids.length > 1 && !confirm('Are you sure you want to remove multiple tabs? \nYou can\'t undo this.'))) return;
	var tabs = CACHED_TABS;
	tabs = tabs.filter(t => !ids.includes(t.id));
	chrome.runtime.sendMessage({logOptions: ['delete', ids]});
	await saveTabs(tabs);
	CACHED_TABS = tabs;
	fillTimeGroups()
}

window.onload = init