// ==UserScript==
// @name Next Step for Trello
// @homepage https://adrienjoly.com/chrome-next-step-for-trello
// @description Check tasks directly from your Trello boards.
// @license CC-BY-NC-ND-4.0; https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode
// @match https://trello.com/*
// @match http://trello.com/*
// @run-at document-start
// ==/UserScript==

// ℹ️ To install Next Step for Trello as a user-script in your favorite browser:
// 1. Install the "Tampermonkey" extension
// 2. Open https://github.com/adrienjoly/chrome-next-step-for-trello/blob/master/dist/next-step-for-trello.user.js
// 3. Click the "raw" button => Tampermonkey should allow you to install it
// 4. Go to a Trello board that contains checklists => refresh the page to see the checklist items appear

/* global window, document */

const URL_PREFIX = 'https://adrienjoly.com/chrome-next-step-for-trello'

const EXT_VERSION = window.chrome ? window.chrome.runtime.getManifest().version : '(user script)'

const getAssetURL = assetFile => window.chrome
  ? window.chrome.runtime.getURL(assetFile) // load from installed extension
  : `${URL_PREFIX}/dist/${assetFile}` // load from github pages

// basic helpers

const nonNull = (item) => !!item

const byPos = (a, b) => a.pos > b.pos ? 1 : -1 // take order into account

const getFirstResult = (fct) => function () {
  return fct.apply(this, arguments)[0]
}

// inject code into the page's context (unrestricted)
function injectJs (jsString, options) {
  options = options || {}
  var scr = document.createElement('script')
  scr.id = options.id
  scr.textContent = jsString;
  // (appending text to a function to convert it's src to string only works in Chrome)
  // add to document to make it run, then hide it
  (document.head || document.documentElement).appendChild(scr)
  if (options.thenRemove) {
    scr.parentNode.removeChild(scr)
  }
}

function getSymbolFromHost (symbolName, callback) {
  // wait for the message
  window.addEventListener(`MyCustomEvent_${symbolName}`, function (e) {
    callback(e.detail.passback)
  })
  // inject code into the page's context (unrestricted)
  return `
    var event = document.createEvent("CustomEvent");
    event.initCustomEvent("MyCustomEvent_${symbolName}", true, true, {"passback": ${symbolName}});
    window.dispatchEvent(event);`
}

// user preferences / cookie helper
function UserPrefs (COOKIE_NAME) {
  const setCookie = (name, value, days = 7, path = '/') => {
    const expires = new Date(Date.now() + days * 864e5).toGMTString()
    document.cookie = name + `=${encodeURIComponent(value)}; expires=${expires}; path=` + path
  }
  const getCookie = (name) =>
    document.cookie.split('; ').reduce((r, v) => {
      const parts = v.split('=')
      return parts[0] === name ? decodeURIComponent(parts[1]) : r
    }, '')
  /*
  const deleteCookie = (name, path) => {
    setCookie(name, '', -1, path)
  }
  */
  return Object.assign(this, {
    get: () => JSON.parse(getCookie(COOKIE_NAME) || '{}'),
    getValue: (key, defaultVal) => {
      let val = this.get()[key]
      return typeof val === 'undefined' ? defaultVal : val
    },
    set: (obj) => setCookie(COOKIE_NAME, JSON.stringify(Object.assign(this.get(), obj))),
    setValue: (key, val) => {
      let obj = {}
      obj[key] = val
      this.set(obj)
    }
  })
}

// announcement helper
function Announcement (announcementId, userPrefs) {
  const SEEN_PROP = 'seen-' + announcementId
  const getCheckCount = () => userPrefs.getValue('checkCounter', 0)
  const shouldDisplay = () => !userPrefs.getValue(SEEN_PROP) && getCheckCount() > 5
  const displayIfNecessary = () =>
    document.body.classList.toggle('aj-nextstep-display-ant', shouldDisplay())
  displayIfNecessary()
  return Object.assign(this, {
    incrementCheckCounter: () => {
      userPrefs.set({ checkCounter: getCheckCount() + 1 })
      displayIfNecessary()
    },
    setAsSeen: () => {
      userPrefs.setValue(SEEN_PROP, true)
      displayIfNecessary()
    }
  })
}

// analytics helper
class Analytics {
  constructor (code = 'UA-XXXXXXXX-X') {
    injectJs(`
      (function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
        (i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
        m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
        })(window,document,'script','https://ssl.google-analytics.com/analytics.js','ga');

      ga('create', '${code}', 'auto', 'nextstep');
      ga('nextstep.send', 'pageview');
      //ga('nextstep.send', 'event', 'test', 'test');
    `)
  };
  trackPage () {
    injectJs(`ga('nextstep.send', 'pageview');`, { thenRemove: true })
  }
  trackEvent (category, action) {
    injectJs(`ga('nextstep.send', 'event', '${category}', '${action}');`, { thenRemove: true })
  }
};

// trello checklist processors

const prefixChecklistName = (item) =>
  Object.assign(item, {
    name: item.checklistName + ': ' + item.name
  })

// this function is used by all modes, to flatten item lists
const sortedNextSteps = (checklist) => checklist.checkItems
  .sort(byPos)
  .filter((item) => (showCompleted() || item.state === 'incomplete'))
  .map((item) => Object.assign(item, {
    cardId: checklist.idCard,
    checklistId: checklist.id,
    checklistName: checklist.name
  }))

const getAllNextSteps = (checklists) => checklists
  .sort(byPos)
  .map(sortedNextSteps)
  .reduce((a, b) => a.concat(b), [])

// functions called by different modes:

// display all next steps
const getAllNextStepsNamed = (checklists) => getAllNextSteps(checklists)
  .map(prefixChecklistName)

// display one next step per checklist
const getNextStepsOfChecklists = (checklists) => checklists
  .sort(byPos)
  .map(getFirstResult(sortedNextSteps))
  .filter(nonNull)
  .reduce((a, b) => a.concat(b), [])
  .map(prefixChecklistName)

// display next steps of first checklist
const getNextStepsOfFirstChecklist = (checklists) => checklists
  .sort(byPos).slice(0, 1)
  .map(sortedNextSteps)
  .reduce((a, b) => a.concat(b), [])

// display the first next step only
const getNextStep = (checklists) => [ getAllNextSteps(checklists)[0] ]
  .filter(nonNull)

// extension modes

const MODES = [
  {
    label: 'Mode: Hidden',
    description: 'Don\'t display next steps',
    handler: (checklists) => ([])
  },
  {
    label: 'Mode: One per card',
    description: 'Display first next step of each card',
    handler: getNextStep
  },
  {
    label: 'Mode: First checklist',
    description: 'Display next steps of each card\'s 1st checklist',
    handler: getNextStepsOfFirstChecklist
  },
  {
    label: 'Mode: First checklist (incl. completed)',
    description: 'Display next steps of each card\'s 1st checklist (including the completed ones)',
    showCompleted: true,
    handler: getNextStepsOfFirstChecklist
  },
  {
    label: 'Mode: One per checklist',
    description: 'Display first next step of each checklist',
    handler: getNextStepsOfChecklists
  },
  {
    label: 'Mode: All steps',
    description: 'Display all unchecked checklist items',
    handler: getAllNextStepsNamed
  },
  {
    label: 'Mode: All steps (incl. completed)',
    description: 'Display all checklist items',
    showCompleted: true,
    handler: getAllNextStepsNamed
  }
]

// app state

const userPrefs = new UserPrefs('aj-nextstep-json')
var analytics = new Analytics('UA-1858235-21')
var currentMode = userPrefs.getValue('defaultMode', 1)
var needsRefresh = true // true = all, or { cardUrls }
var refreshing = false
var token // needed by onCheckItem, populated by getToken()
var initialized = false // populated by init()
var watching = false // populated by watchForChanges()
var announcement

function showCompleted () {
  return MODES[currentMode].showCompleted
}

function setMode (modeIndex) {
  currentMode = modeIndex
  needsRefresh = true
  userPrefs.setValue('defaultMode', modeIndex)
  analytics.trackEvent(MODES[currentMode].label, 'click')
}

var MENU_ITEMS = MODES.map((mode, i) => {
  return Object.assign(mode, {
    modeIndex: i,
    onClick: () => setMode(i)
  })
})

// Trello helpers

const extractId = (url = window.location.href) => url.split('/')[4] // ooooh! this is dirty!

const shortUrl = (url) => url.split('/', 5).join('/')

const getCardElementByShortUrl = (shortUrl) =>
  Array.from(document.querySelectorAll(`.list-card[href^="${shortUrl.split('.com')[1]}"] .list-card-title`)).pop()

const isOnBoardPage = () => window.location.href.indexOf('https://trello.com/b/') === 0

function getUserName () {
  const user =
    document.querySelector('button[data-test-id="header-member-menu-button"]') || document.getElementsByClassName('header-user')[0].getElementsByClassName('member-avatar')[0]
  return user ? /\((.*)\)/.exec(user.title)[1] : undefined
}

const fetchFromTrello = (path, opts = {}) => window.fetch(
  `https://trello.com/1/${path}`,
  Object.assign({}, opts, {
    credentials: 'include',
    headers: Object.assign({}, opts.headers, {
      'x-trello-user-agent-extension': 'nextStepForTrello'
    })
  })
)

const fetchBoardChecklists = (boardId = extractId()) =>
  fetchFromTrello(`boards/${boardId}/checklists?cards=open&card_fields=shortUrl`)
    .then((res) => res.json())

// Toolbar UI

function toggleLoadingUI (state) {
  refreshing = !!state
  document.getElementById('aj-nextstep-btn').classList.toggle('is-loading', state || false)
}

function initToolbarButton () {
  var btn = document.createElement('a')
  btn.href = 'http://adrienjoly.com/chrome-next-step-for-trello'
  btn.title = 'Click to toggle display of next task(s)'
  btn.id = 'aj-nextstep-btn'
  btn.className = 'board-header-btn board-header-btn-without-icon'
  var iconUrl = getAssetURL('icon.png')
  btn.innerHTML = '<span class="board-header-btn-text">' +
    '<div id="aj-nextstep-loading" class="uil-reload-css"><div></div></div>' +
    '<img class="aj-nextstep-icon" src="' + iconUrl + '" />' +
    '<span class="aj-nextstep-ant-icon" style="display: none;">1</span>' + // announcement
    '<span id="aj-nextstep-mode">Next steps</span>' +
    '</span>'
  announcement = new Announcement('ant7', userPrefs)
  return btn
}

const renderSelectorOption = (menuItem, i) => `
  <li>
    <a id="aj-nextstep-menuitem-${i}" class="js-select light-hover ${menuItem.className || ''}"
       href="${menuItem.href || '#'}" ${menuItem.href ? 'target="_blank"' : ''} name="org">
      ${menuItem.label}
      ${currentMode === menuItem.modeIndex ? '<span class="icon-sm icon-check"></span>' : ''}
      <span class="sub-name">${menuItem.description}</span>
    </a>
  </li>`

const renderToolbarSelector = (selectorId, innerHTML) => `
  <div class="pop-over-header js-pop-over-header">
    <a
      class="pop-over-header-title"
      href="${URL_PREFIX}/"
      target="_blank">ℹ️ Next Step for Trello ${EXT_VERSION}</a>
    <a
      href="#"
      class="pop-over-header-close-btn icon-sm icon-close"
      onclick="document.getElementById('${selectorId}').parentNode.removeChild(document.getElementById('${selectorId}'))">
    </a>
  </div>
  <div>
    <div class="pop-over-content js-pop-over-content u-fancy-scrollbar js-tab-parent" style="max-height: 599px;">
      <div>
        <ul class="pop-over-list" id="aj-nextstep-modes">
          ${innerHTML}
        </ul>
      </div>
    </div>
  </div>`

function showToolbarSelector (btn) {
  const node = document.createElement('div')
  node.id = 'aj-nextstep-selector'
  node.className = 'pop-over'
  node.hide = () => {
    node.parentNode.removeChild(node)
    analytics.trackEvent('Toolbar Button', 'hide')
  }
  // prepare carbonads sponsor message
  const donateClass = 'aj-nextstep-ant-donate' // will disappear when ad is shown
  const adCode = 'CK7D65QL'
  const adClass = 'native-js'
  const adHTML = `
  <div class="${adClass}">
    <a class="native-ad" href="#native_link#" target="_blank" rel="noopener noreferrer">
      <style>
        .native-sponsor {
          background-color: #native_bg_color#;
          color: #native_color#;
        }
        .native-ad { background: repeating-linear-gradient(-45deg, transparent, transparent 5px, hsla(0, 0%, 0%, .03) 5px, hsla(0, 0%, 0%, .03) 10px) #native_bg_color#0D; }
        .native-ad:after { background-color: #native_bg_color#;}
        .native-cta {
          background-color: #native_cta_bg_color#;
          color: #native_cta_color#;
        }
        .native-cta:hover {
          background-color: #native_cta_bg_color_hover#;
          color: #native_cta_color_hover;
        }
      </style>
      <span class="native-sponsor #native_index#">Sponsored by #native_company#</span>
      <div class="native-flex">
        <span class="native-desc">#native_desc#</span>
        <span class="native-cta #native_index#">#native_cta#</span>
      </div>
    </a>
  </div>`
  // render menu items
  node.innerHTML =
    renderToolbarSelector(
      node.id,
      MENU_ITEMS.map(renderSelectorOption).join('\n')
    ) + adHTML
  setTimeout(() => {
    // make menu items clickable
    MENU_ITEMS.forEach((menuItem, i) => {
      document.getElementById('aj-nextstep-menuitem-' + i).onclick = function () {
        menuItem.onClick.apply(this, arguments)
        node.hide()
      }
    })
    // sponsored message
    injectJs(`
      (function(){
        if(typeof _native !== 'undefined' && _native) {
          _native.init('${adCode}', { targetClass: '${adClass}' });
          // var donate = document.getElementsByClassName('${donateClass}')[0];
          // donate.parentNode.removeChild(donate);
        }
      })();
    `)
    announcement.setAsSeen()
  }, 1)
  const rect = btn.getBoundingClientRect()
  node.style = `top: ${rect.top + rect.height + window.scrollY}px; left: ${rect.left + window.scrollX}px;`
  node.classList.add('is-shown')
  // heap.track('Click on toolbar button', {});
  analytics.trackEvent('Toolbar Button', 'show')
  return node
}

// Trello markdown rendering functions

function renderAtMention (userName) {
  let meClass = userName === '@' + getUserName() ? ' me' : ''
  return '<span class="atMention' + meClass + '">' + userName + '</span>'
}

const renderMarkdownSymbols = (text) => text
  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  .replace(/__(.*?)__/g, '<strong>$1</strong>')
  .replace(/\*(?!\*)(.*?)\*(?!\*)/g, '<em>$1</em>')
  .replace(/_(?!_)(.*?)_(?!_)/g, '<em>$1</em>')
  .replace(/~~(.*?)~~/g, '<del>$1</del>')
  .replace(/@\w+/g, renderAtMention)

const getMarkdownPatternsToReplace = () => [
  {
    regEx: /`{3}(.*?)`{3}|`{1}(.*?)`{1}/g,
    replacement: '<code>$1$2</code>'
  },
  {
    regEx: /(^|[^\]][^(])(https?:\/\/([^/ ]+)[^ ]+)/g,
    replacement: '$1<a href="$2" class="aj-md-hyperlink">$2</a>'
  },
  {
    regEx: /\[([^\]]*)\]\(([^)]*)\)/g,
    replacement: '<a href="$2" class="aj-md-hyperlink">$1</a>'
  }
]

const getMarkdownPlaceholders = (text) =>
  getMarkdownPatternsToReplace().reduce((placeholders, pattern) =>
    placeholders.concat((text.match(pattern.regEx) || []).map((match, i) => ({
      name: 'next-step-for-trello-placeholder-' + (placeholders.length + i),
      text: match,
      regEx: pattern.regEx,
      replacement: pattern.replacement
    }))), [])

const replaceMarkdownWithPlaceholders = (text, placeholders) =>
  placeholders.reduce((text, placeholder) =>
    text.replace(placeholder.text, placeholder.name), text)

const renderMdPlaceholder = (placeholder) =>
  placeholder.text.replace(placeholder.regEx, placeholder.replacement)

const renderMarkdownPlaceholders = (text, placeholders) =>
  placeholders.reduce((text, placeholder) =>
    text.replace(placeholder.name, renderMdPlaceholder(placeholder)), text)

function renderMarkdown (text) {
  // Code and links should not have Markdown formatting applied.  So remove
  // them from the text and replace with placeholders for now.
  var placeholders = getMarkdownPlaceholders(text)
  text = replaceMarkdownWithPlaceholders(text, placeholders)
  // Apply markdown rendering to the remaining text
  text = renderMarkdownSymbols(text)
  // Replace the placeholders with HTML code blocks/URLs
  text = renderMarkdownPlaceholders(text, placeholders)
  return text
}

// Next Step UI

const renderItem = (item) => `
  <p class="aj-next-step ${(item.state === 'complete' && showCompleted()) && 'aj-checking'}"
     data-card-url="${item.cardUrl}"
     data-card-id="${item.cardId}"
     data-checklist-id="${item.checklistId}"
     data-item-id="${item.id}" >
        <span class="aj-checkbox checklist-item-checkbox"></span>
        <span class="aj-checkbox-tick"></span>
        <span class="aj-item-name"> ${renderMarkdown(item.name)} </span>
  </p>`

// check off a checklist item directly from the Trello board.
function onCheckItem (evt) {
  evt.preventDefault()
  evt.stopPropagation()
  if (!token) {
    window.alert('Oops! A recent change from Trello broke the ability to check off an item... If you want to help us fix this 👉 http://bit.ly/nextsteptoken')
    return
  }
  // let's check that item
  var item = evt.currentTarget.parentNode
  item.classList.add('aj-checking')
  item.style.height = item.offsetHeight + 'px'
  // let's tell trello
  var path = 'cards/' + item.getAttribute('data-card-id') +
    '/checklist/' + item.getAttribute('data-checklist-id') +
    '/checkItem/' + item.getAttribute('data-item-id')
  var urlEncodedData = 'state=complete&token=' + token.trim()
  fetchFromTrello(path, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': urlEncodedData.length
    },
    body: urlEncodedData
  }).then(function () {
    // hide the task progressively
    if (!showCompleted()) {
      item.classList.add('aj-checked')
    }
    // will make the list of tasks refresh
    needsRefresh = {
      cardUrls: [ item.getAttribute('data-card-url') ]
    }
    // increment check counter
    announcement.incrementCheckCounter()
  })
  analytics.trackEvent('Checklist item', 'tick')
}

const getCardUrlFromTitleElement = (cardTitleElement) => {
  return cardTitleElement.parentNode.parentNode.href
}

function setCardContent (cardTitleElement, items) {
  var cardElement = cardTitleElement.parentNode
  var taskList = cardElement.getElementsByClassName('aj-task-list')[0]
  // if task list div does not exist => create it
  if (!taskList) {
    taskList = document.createElement('div')
    taskList.className = 'aj-task-list'
    const badgesEl = cardTitleElement.parentNode.getElementsByClassName('badges')[0]
    cardElement.insertBefore(taskList, badgesEl)
    // rely on the .badges element to avoid conflict with plus-for-trello
  }
  taskList.innerHTML = (items || [])
    .map((item) => Object.assign(item, { cardUrl: getCardUrlFromTitleElement(cardTitleElement) }))
    .map(renderItem).join('\n')
  // attach click handlers on checkboxes
  var checkboxes = taskList.getElementsByClassName('aj-checkbox-tick')
  for (var i = 0; i < checkboxes.length; ++i) {
    checkboxes[i].addEventListener('click', onCheckItem)
  }
}

const updateCardElements = (cards) => {
  const handler = MODES[currentMode].handler
  cards.forEach((card) => {
    const cardElement = getCardElementByShortUrl(card.shortUrl)
    // console.log('-', card.shortUrl, cardElement)
    return cardElement && setCardContent(cardElement, handler(card.checklists))
  })
}

function updateCards (toRefresh) {
  toggleLoadingUI(true)
  fetchBoardChecklists().then((checklists) => {
    // 1. filter cards that contain checklists
    let cards = Object.values(checklists.reduce((cards, checklist) => {
      const shortUrl = (checklist.cards[0] || {}).shortUrl
      if (shortUrl) {
        cards[shortUrl] = cards[shortUrl] || { shortUrl, checklists: [] }
        cards[shortUrl].checklists.push(checklist)
      }
      return cards // TODO: rewrite this function
    }, {}))
    // 2. only refresh specified cards (e.g. when checking an item of a card)
    if ((toRefresh || {}).cardUrls) {
      const shortUrls = toRefresh.cardUrls.map(shortUrl)
      cards = cards.filter((card) => shortUrls.includes(card.shortUrl))
    }
    updateCardElements(cards)
    toggleLoadingUI(false)
  })
}

// extension initialization

const isToolbarInstalled = () => document.getElementById('aj-nextstep-mode')

function installToolbar () {
  var headerElements = document.getElementsByClassName('board-header-btns')
  if (headerElements.length) {
    const btn = initToolbarButton() // creates #aj-nextstep-mode
    headerElements[0].appendChild(btn)
    btn.onclick = (evt) => {
      evt.preventDefault()
      const popover = document.getElementById('aj-nextstep-selector')
      if (popover) {
        popover.hide()
      } else {
        document.body.appendChild(showToolbarSelector(btn)) // creates #aj-nextstep-selector
      }
    }
    needsRefresh = true
    analytics.trackEvent('Board', 'install-toolbar')
  }
}

const elementIsTrelloCard = (element) =>
  element.classList &&
  element.classList.contains('list-card') &&
  element.classList.contains('js-member-droppable') &&
  element.classList.contains('active-card') &&
  element.classList.contains('ui-droppable')

function watchForChanges () {
  /*
  // refresh on card name change
  document.body.addEventListener('DOMSubtreeModified', function(e){
    if ('list-card-details' === e.target.className) {
      needsRefresh = true; // TODO: use { cardUrls } instead
    }
  }, false);
  // TODO: re-activate name change detection without interfering with drag&drop with single ajax request, below:
  */
  // refresh after drag&dropping a card to another column
  document.body.addEventListener('DOMNodeInserted', function (e) {
    if (elementIsTrelloCard(e.target)) {
      needsRefresh = true // less aggressive than updateCards({ cardUrls: [ e.target.href ] })
    }
  }, false)
  watching = true
}

/*
const loadAnnouncement = () => fetch(getAssetURL('announcement.json'))
  .then((response) => response.json())
  .catch(() => ({
    label: '✍ Any feedback on Next Step for Trello?',
    description: 'Let me know how I can help, or give us some stars!',
    className: 'aj-nextstep-ant-menuitem aj-nextstep-ant-feedback',
    href: 'https://chrome.google.com/webstore/detail/next-step-for-trello/iajhmklhilkjgabejjemfbhmclgnmamf'
  }))
  .then((json) => MENU_ITEMS.push(Object.assign(json, {
    onClick: (evt) => announcement.setAsSeen()
  })))

const injectAnalytics = () => injectJs(`
  window.heap=window.heap||[],heap.load=function(e,t){window.heap.appid=e,window.heap.config=t=t||{};var r=t.forceSSL||"https:"===document.location.protocol,a=document.createElement("script");a.type="text/javascript",a.async=!0,a.src=(r?"https:":"http:")+"//cdn.heapanalytics.com/js/heap-"+e+".js";var n=document.getElementsByTagName("script")[0];n.parentNode.insertBefore(a,n);for(var o=function(e){return function(){heap.push([e].concat(Array.prototype.slice.call(arguments,0)))}},p=["addEventProperties","addUserProperties","clearEventProperties","identify","removeEventProperty","setEventProperties","track","unsetEventProperty"],c=0;c<p.length;c++)heap[p[c]]=o(p[c])};
  heap.load("3050518868");
`)
*/

const getToken = () => injectJs(
  getSymbolFromHost(
    'window.getAuthorization().token',
    (_token) => { token = _token }
  ),
  { thenRemove: true }
)

function init () {
  injectJs(`
  var script = document.createElement('script');
  script.src = '${URL_PREFIX}/assets/native.js';
  document.body.appendChild(script);
  `)
  if (!window.chrome) {
    // in a user-script context (e.g. using tampermonkey), we need to load the css manually
    injectJs(`
    var nextStepTrelloStyle = document.createElement('link');
    nextStepTrelloStyle.rel = 'stylesheet';
    nextStepTrelloStyle.href = '${getAssetURL('next-step-for-trello.css')}';
    document.head.appendChild(nextStepTrelloStyle);
    `)
  }
  initialized = true
}

function regularUpdate () {
  if (isOnBoardPage()) {
    if (!initialized) {
      return init()
    }
    if (!token) {
      return getToken()
    }
    if (!isToolbarInstalled()) {
      return installToolbar()
    }
    if (!watching) {
      return watchForChanges()
    }
    if (needsRefresh && !refreshing) {
      updateCards(needsRefresh)
      needsRefresh = false
      analytics.trackPage()
      analytics.trackEvent('Board', 'refresh')
    }
  } else if (!needsRefresh) {
    needsRefresh = true
    analytics.trackPage()
  }
}

// Main loop
setInterval(regularUpdate, 500)
