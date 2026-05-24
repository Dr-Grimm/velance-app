import { formatLocalDateKey } from './dateKey.js'

export const TRACKING_CLASSIFICATION_VERSION = 'tracking-v7.0'
export const TRACKING_LANE_KEYS = Object.freeze(['productive', 'supporting', 'unclear', 'distracting'])
export const TRACKING_LANE_META = Object.freeze({
  productive: {
    key: 'productive',
    label: 'Productive',
    color: '#14B8A6',
    strong: '#0f766e',
    soft: 'rgba(20, 184, 166, 0.12)',
    accent: 'rgba(20, 184, 166, 0.18)',
    gradientFrom: '#45dbc8',
    gradientTo: '#14B8A6',
  },
  supporting: {
    key: 'supporting',
    label: 'Supporting',
    color: '#7C3AED',
    strong: '#5B21B6',
    soft: 'rgba(124, 58, 237, 0.13)',
    accent: 'rgba(124, 58, 237, 0.2)',
    gradientFrom: '#A78BFA',
    gradientTo: '#7C3AED',
  },
  unclear: {
    key: 'unclear',
    label: 'Unclear',
    color: '#F97316',
    strong: '#C2410C',
    soft: 'rgba(249, 115, 22, 0.14)',
    accent: 'rgba(249, 115, 22, 0.19)',
    gradientFrom: '#FDBA74',
    gradientTo: '#F97316',
  },
  distracting: {
    key: 'distracting',
    label: 'Distracting',
    color: '#FB7185',
    strong: '#be123c',
    soft: 'rgba(251, 113, 133, 0.12)',
    accent: 'rgba(251, 113, 133, 0.18)',
    gradientFrom: '#fb9cb0',
    gradientTo: '#FB7185',
  },
})

export function getTrackingLaneMeta(lane = 'unclear') {
  const normalizedLane = normalizeLaneKey(lane)
  return TRACKING_LANE_META[normalizedLane] || TRACKING_LANE_META.unclear
}

const APP_RULES = [
  { match: ['Code', 'VSCode', 'VS Code', 'Visual Studio Code', 'Code - OSS', 'WebStorm', 'PyCharm', 'IntelliJ', 'Xcode', 'Atom', 'Sublime Text', 'Vim', 'Neovim', 'Android Studio', 'Eclipse', 'NetBeans', 'RubyMine', 'CLion', 'GoLand', 'Fleet', 'Cursor', 'Zed', 'Nova', 'BBEdit', 'Helix', 'Lapce'], category: 'Development', subcategory: 'IDE', color: '#00B4D8', productive: true },
  { match: ['Terminal', 'iTerm', 'iTerm2', 'PowerShell', 'cmd.exe', 'WindowsTerminal', 'Windows Terminal', 'Warp', 'Hyper', 'Alacritty', 'kitty', 'bash', 'zsh', 'fish', 'Konsole', 'GNOME Terminal', 'xterm'], category: 'Development', subcategory: 'Terminal', color: '#00B4D8', productive: true },
  { match: ['GitHub Desktop', 'GitKraken', 'Fork', 'SourceTree', 'Tower', 'SmartGit'], category: 'Development', subcategory: 'Git', color: '#00B4D8', productive: true },
  { match: ['Postman', 'Insomnia', 'Paw', 'HTTPie', 'RapidAPI', 'Bruno'], category: 'Development', subcategory: 'API Tool', color: '#00B4D8', productive: true },
  { match: ['Docker', 'Rancher Desktop', 'Podman', 'OrbStack', 'Lima'], category: 'Development', subcategory: 'DevOps', color: '#00B4D8', productive: true },
  { match: ['TablePlus', 'DBeaver', 'DataGrip', 'Sequel Pro', 'Sequel Ace', 'MongoDB Compass', 'Robo 3T', 'pgAdmin'], category: 'Development', subcategory: 'Database', color: '#00B4D8', productive: true },
  { match: ['Figma', 'Sketch', 'Adobe XD', 'Framer', 'Canva', 'Affinity Designer', 'Affinity Photo', 'InVision', 'Zeplin', 'Marvel', 'Maze', 'ProtoPie'], category: 'Design', subcategory: 'UI Design', color: '#F59E0B', productive: true },
  { match: ['Photoshop', 'Illustrator', 'Lightroom', 'Premiere', 'After Effects', 'DaVinci Resolve', 'Final Cut', 'Capture One', 'Luminar', 'GIMP', 'Inkscape', 'Blender', 'Cinema 4D', 'Lottie'], category: 'Design', subcategory: 'Creative', color: '#F59E0B', productive: true },
  { match: ['Word', 'Pages', 'LibreOffice', 'Writer', 'Typora', 'Obsidian', 'Notion', 'Bear', 'iA Writer', 'Ulysses', 'Scrivener', 'Craft', 'Logseq', 'Roam Research', 'Capacities', 'Anytype'], category: 'Writing', subcategory: 'Document', color: '#52B788', productive: true },
  { match: ['Excel', 'Numbers', 'Airtable', 'LibreOffice Calc'], category: 'Writing', subcategory: 'Spreadsheet', color: '#52B788', productive: true },
  { match: ['PowerPoint', 'Keynote', 'Google Slides', 'Pitch', 'Prezi', 'Beautiful.ai', 'Gamma'], category: 'Writing', subcategory: 'Presentation', color: '#52B788', productive: true },
  { match: ['Slack', 'Microsoft Teams', 'Zoom', 'Google Meet', 'Discord', 'Telegram', 'Signal', 'WhatsApp', 'Skype', 'Webex', 'Loom', 'Around', 'Gather'], category: 'Communication', subcategory: 'Messaging', color: '#9B51E0', productive: true },
  { match: ['Outlook', 'Mail', 'Thunderbird', 'Apple Mail', 'Spark', 'HEY', 'Mimestream', 'Superhuman', 'Airmail'], category: 'Communication', subcategory: 'Email', color: '#9B51E0', productive: true },
  { match: ['Linear', 'Jira', 'Asana', 'Trello', 'ClickUp', 'Monday', 'Basecamp', 'Todoist', 'Things', 'OmniFocus', 'Height', 'Shortcut', 'Plane', 'Notion Calendar', 'Fantastical'], category: 'Project Mgmt', subcategory: 'Planning', color: '#6B5CE7', productive: true },
  { match: ['ChatGPT', 'Claude', 'Gemini', 'Copilot', 'Perplexity', 'Raycast AI', 'Codex'], category: 'AI Tools', subcategory: 'AI Assistant', color: '#6B5CE7', productive: true },
  { match: ['Spotify', 'iTunes', 'Music', 'Deezer', 'Tidal', 'Apple Music', 'YouTube Music', 'Cider', 'Capo'], category: 'Music', subcategory: 'Audio', color: '#1DB954', productive: true },
  { match: ['Netflix', 'Disney+', 'Hulu', 'Amazon Prime', 'HBO Max', 'Crunchyroll', 'VLC', 'IINA', 'mpv', 'Plex', 'Infuse', 'Emby', 'Jellyfin', 'QuickTime Player'], category: 'Entertainment', subcategory: 'Streaming', color: '#EF4444', productive: false },
  { match: ['Steam', 'Epic Games', 'Battle.net', 'Origin', 'GOG Galaxy', 'Valorant', 'League of Legends', 'Minecraft', 'Roblox', 'Among Us', 'Fortnite', 'CS2', 'Counter-Strike', 'Hearthstone', 'Overwatch'], category: 'Entertainment', subcategory: 'Gaming', color: '#EF4444', productive: false },
  { match: ['Finder', 'Explorer', 'Files', 'Dolphin', 'Nautilus', 'Nemo', 'Thunar'], category: 'System', subcategory: 'File Manager', color: '#8E95A3', productive: true },
  { match: ['System Preferences', 'System Settings', 'Control Panel', 'Settings', 'Activity Monitor', 'Task Manager', 'Resource Monitor'], category: 'System', subcategory: 'Settings', color: '#8E95A3', productive: true },
  { match: ['Raycast', 'Alfred', 'Spotlight', 'PowerToys', 'ueli', 'Wox', 'Launchy'], category: 'System', subcategory: 'Launcher', color: '#8E95A3', productive: true },
  { match: ['1Password', 'Bitwarden', 'LastPass', 'Dashlane', 'Keychain'], category: 'System', subcategory: 'Security', color: '#8E95A3', productive: true },
  { match: ['Calendar', 'Fantastical', 'Notion Calendar', 'Cron', 'Calendly'], category: 'System', subcategory: 'Calendar', color: '#6B5CE7', productive: true },
  { match: ['Clock', 'Time Zone Pro', 'World Clock', 'Menu Weather', 'Dato'], category: 'System', subcategory: 'Utility', color: '#8E95A3', productive: true },
]

const BROWSER_RULES = [
  { match: ['studio.youtube.com', 'YouTube Studio'], category: 'Writing', subcategory: 'Creator Studio', color: '#52B788', productive: true, lane: 'productive', confidence: 0.94 },
  { match: ['drive.google.com', 'Google Drive'], category: 'Writing', subcategory: 'Workspace Drive', color: '#52B788', productive: true, lane: 'supporting', confidence: 0.9 },
  { match: ['calendar.google.com', 'Google Calendar'], category: 'Communication', subcategory: 'Calendar', color: '#9B51E0', productive: true, lane: 'supporting', confidence: 0.9 },
  { match: ['meet.google.com', 'Google Meet'], category: 'Communication', subcategory: 'Meeting', color: '#9B51E0', productive: true, lane: 'supporting', confidence: 0.92 },
  { match: ['chat.google.com', 'Google Chat'], category: 'Communication', subcategory: 'Messaging', color: '#9B51E0', productive: true, lane: 'supporting', confidence: 0.9 },
  { match: ['keep.google.com', 'Google Keep'], category: 'Writing', subcategory: 'Notes', color: '#52B788', productive: true, lane: 'supporting', confidence: 0.88 },
  { match: ['sites.google.com', 'Google Sites'], category: 'Writing', subcategory: 'Site Builder', color: '#52B788', productive: true, lane: 'productive', confidence: 0.9 },
  { match: ['developers.google.com', 'support.google.com', 'workspace.google.com', 'classroom.google.com', 'notebooklm.google.com'], category: 'Learning', subcategory: 'Reference', color: '#52B788', productive: true, lane: 'supporting', confidence: 0.88 },
  { match: ['YouTube', 'youtube.com'], category: 'Entertainment', subcategory: 'Video', color: '#EF4444', productive: false, lane: 'distracting', confidence: 0.96 },
  { match: ['Netflix', 'Hulu', 'Disney+', 'HBO Max', 'Amazon Prime Video', 'Crunchyroll', 'Twitch', 'twitch.tv', 'peacocktv', 'Apple TV', 'Paramount+'], category: 'Entertainment', subcategory: 'Streaming', color: '#EF4444', productive: false, lane: 'distracting', confidence: 0.96 },
  { match: ['TikTok', 'tiktok.com'], category: 'Entertainment', subcategory: 'Short Video', color: '#EF4444', productive: false, lane: 'distracting', confidence: 0.97 },
  { match: ['Twitter', 'X.com', 'x.com/'], category: 'Social Media', subcategory: 'Twitter/X', color: '#EC4899', productive: false, lane: 'distracting', confidence: 0.95 },
  { match: ['Facebook', 'facebook.com'], category: 'Social Media', subcategory: 'Facebook', color: '#EC4899', productive: false, lane: 'distracting', confidence: 0.95 },
  { match: ['Instagram', 'instagram.com'], category: 'Social Media', subcategory: 'Instagram', color: '#EC4899', productive: false, lane: 'distracting', confidence: 0.95 },
  { match: ['Reddit', 'reddit.com'], category: 'Social Media', subcategory: 'Reddit', color: '#EC4899', productive: false, lane: 'distracting', confidence: 0.9 },
  { match: ['LinkedIn', 'linkedin.com'], category: 'Social Media', subcategory: 'LinkedIn', color: '#EC4899', productive: null, lane: 'unclear', confidence: 0.7 },
  { match: ['Snapchat', 'Threads', 'BeReal', 'Mastodon', 'Bluesky'], category: 'Social Media', subcategory: 'Social', color: '#EC4899', productive: false, lane: 'distracting', confidence: 0.94 },
  { match: ['GitHub', 'github.com', 'GitLab', 'Bitbucket', 'gitea'], category: 'Development', subcategory: 'Version Control', color: '#00B4D8', productive: true, lane: 'productive', confidence: 0.92 },
  { match: ['Stack Overflow', 'stackoverflow.com', 'MDN', 'mozilla.org/docs', 'DevDocs', 'devdocs.io', 'npm', 'npmjs.com', 'crates.io', 'PyPI', 'pypi.org', 'rubygems.org', 'pkg.go.dev'], category: 'Development', subcategory: 'Docs/Research', color: '#00B4D8', productive: true, lane: 'supporting', confidence: 0.9 },
  { match: ['localhost', '127.0.0.1', ':3000', ':8080', ':5173', ':4200', ':8000', ':8888'], category: 'Development', subcategory: 'Local Dev', color: '#00B4D8', productive: true, lane: 'productive', confidence: 0.97 },
  { match: ['Vercel', 'vercel.com', 'Netlify', 'netlify.com', 'Railway', 'railway.app', 'Heroku', 'AWS Console', 'aws.amazon.com', 'Google Cloud Console', 'console.cloud.google.com', 'Azure Portal', 'portal.azure.com', 'Cloudflare', 'Supabase', 'supabase.com', 'PlanetScale', 'Neon', 'Render', 'Fly.io'], category: 'Development', subcategory: 'Cloud/Deploy', color: '#00B4D8', productive: true, lane: 'productive', confidence: 0.9 },
  { match: ['CodePen', 'codepen.io', 'CodeSandbox', 'codesandbox.io', 'StackBlitz', 'stackblitz.com', 'Replit', 'replit.com', 'Colab', 'colab.research.google.com'], category: 'Development', subcategory: 'Online IDE', color: '#00B4D8', productive: true, lane: 'productive', confidence: 0.95 },
  { match: ['Linear', 'linear.app', 'Jira', 'atlassian.com/jira', 'Asana', 'asana.com', 'ClickUp', 'app.clickup.com', 'monday.com', 'basecamp.com'], category: 'Project Mgmt', subcategory: 'PM Tool', color: '#6B5CE7', productive: true, lane: 'supporting', confidence: 0.9 },
  { match: ['ChatGPT', 'chat.openai.com', 'chatgpt.com', 'openai.com', 'Codex', 'Claude', 'claude.ai', 'Gemini', 'gemini.google.com', 'Anthropic', 'Perplexity', 'perplexity.ai', 'Copilot', 'copilot.microsoft.com', 'v0.dev', 'Midjourney', 'midjourney.com', 'Poe', 'poe.com', 'Kagi', 'HuggingFace', 'huggingface.co'], category: 'AI Tools', subcategory: 'AI Assistant', color: '#6B5CE7', productive: true, lane: 'supporting', confidence: 0.88 },
  { match: ['Canva', 'canva.com', 'Figma', 'figma.com', 'Framer', 'framer.com'], category: 'Design', subcategory: 'Design Workspace', color: '#F59E0B', productive: true, lane: 'productive', confidence: 0.93 },
  { match: ['Google Docs', 'docs.google.com', 'Google Sheets', 'sheets.google.com', 'Google Slides', 'slides.google.com', 'Notion', 'notion.so', 'Confluence', 'Coda', 'coda.io', 'Airtable', 'airtable.com', 'Miro', 'miro.com', 'FigJam', 'Loom', 'loom.com'], category: 'Writing', subcategory: 'Online Doc', color: '#52B788', productive: true, lane: 'productive', confidence: 0.9 },
  { match: ['Gmail', 'mail.google.com', 'Outlook', 'outlook.live.com', 'Yahoo Mail', 'Fastmail', 'ProtonMail', 'proton.me/mail', 'Hey.com', 'Superhuman'], category: 'Communication', subcategory: 'Email', color: '#9B51E0', productive: true, lane: 'supporting', confidence: 0.88 },
  { match: ['Slack', 'app.slack.com', 'Discord', 'discord.com', 'Teams', 'teams.microsoft.com', 'Zoom', 'zoom.us', 'Telegram', 'web.telegram.org', 'WhatsApp', 'web.whatsapp.com'], category: 'Communication', subcategory: 'Messaging', color: '#9B51E0', productive: true, lane: 'supporting', confidence: 0.88 },
  { match: ['Udemy', 'udemy.com', 'Coursera', 'coursera.org', 'Khan Academy', 'khanacademy.org', 'LinkedIn Learning', 'Pluralsight', 'pluralsight.com', 'Frontend Masters', 'frontendmasters.com', 'Egghead', 'egghead.io', 'Wikipedia', 'wikipedia.org', 'Scrimba', 'scrimba.com', 'freeCodeCamp', 'The Odin Project', 'exercism.org'], category: 'Learning', subcategory: 'Course', color: '#52B788', productive: true, lane: 'supporting', confidence: 0.9 },
  { match: ['Hacker News', 'news.ycombinator.com', 'Product Hunt', 'producthunt.com', 'The Verge', 'theverge.com', 'TechCrunch', 'techcrunch.com', 'Medium', 'medium.com', 'Substack', 'substack.com', 'Dev.to', 'dev.to', 'Hashnode', 'hashnode.dev', 'Smashing Magazine', 'CSS-Tricks', 'css-tricks.com'], category: 'Reading', subcategory: 'Tech News', color: '#F59E0B', productive: true, lane: 'supporting', confidence: 0.76 },
  { match: ['Amazon', 'amazon.com', 'eBay', 'ebay.com', 'Shopee', 'shopee.com', 'AliExpress', 'aliexpress.com', 'Etsy', 'etsy.com', 'Depop', 'depop.com', 'Lazada', 'Shein'], category: 'Shopping', subcategory: 'E-Commerce', color: '#F59E0B', productive: false, lane: 'distracting', confidence: 0.94 },
]

const BROWSER_APPS = ['Chrome', 'Google Chrome', 'Firefox', 'Safari', 'Edge', 'Microsoft Edge', 'Brave', 'Opera', 'Arc', 'Vivaldi', 'Chromium']

const YOUTUBE_PRODUCTIVE_KEYWORDS = [
  'tutorial', 'course', 'lesson', 'lecture', 'learn', 'learning', 'how to', 'bootcamp',
  'masterclass', 'workshop', 'study', 'revision', 'practice', 'from scratch', 'walkthrough for beginners',
  'coding', 'programming', 'developer', 'development', 'javascript', 'typescript', 'react', 'vue',
  'node', 'python', 'java', 'c++', 'c#', 'golang', 'rust', 'sql', 'system design', 'data structures',
  'algorithms', 'leetcode', 'debug', 'math', 'physics', 'chemistry', 'biology', 'economics',
  'language learning', 'english lesson', 'ielts', 'toefl', 'exam prep',
]

const YOUTUBE_DISTRACTING_KEYWORDS = [
  'shorts', 'music video', 'official video', 'lyric video', 'reaction', 'prank', 'meme', 'funny',
  'highlights', 'gameplay', 'walkthrough', 'clip', 'trailer', 'vlog', 'podcast clip', 'compilation',
  'celebrity', 'news recap', 'asmr', 'live stream', 'match highlights', 'streamer', 'streamers',
  'ranked', 'montage', 'best moments', 'insane clips', 'fails', 'funniest', 'gaming',
  'trending', 'viral', 'ipl', 'cricket', 'football', 'soccer', 'basketball', 'nba', 'f1',
  'motogp', 'wwe', 'ufc', 'esports', 'troll', 'roast',
]

const MEDIA_DISTRACTING_KEYWORDS = [
  'song', 'songs', 'lyrics', 'lyric', 'official audio', 'official music video', 'video song',
  'full album', 'album', 'playlist', 'karaoke', 'soundtrack', 'ost', 'bgm', 'audio jukebox',
]

const GOOGLE_SEARCH_PRODUCTIVE_KEYWORDS = [
  'how to', 'tutorial', 'guide', 'documentation', 'docs', 'reference', 'api', 'fix', 'debug',
  'error', 'course', 'lesson', 'learn', 'research', 'best practice', 'design', 'system design',
  'presentation', 'slides', 'deck', 'meeting agenda', 'roadmap', 'requirements', 'openai',
  'chatgpt', 'codex', 'gemini', 'claude', 'github', 'stack overflow',
]

const GOOGLE_SEARCH_DISTRACTING_KEYWORDS = [
  'gameplay', 'stream', 'streamer', 'clips', 'highlight', 'highlights', 'music', 'lyrics',
  'song', 'vlog', 'meme', 'funny', 'reaction', 'shorts', 'trailer', 'movie', 'anime',
  'football highlights', 'valorant', 'fortnite', 'roblox', 'celebrity', 'shopping',
]

const PRODUCTIVE_BROWSER_CONTEXT_KEYWORDS = [
  'pull request', 'merge request', 'issue', 'issues', 'commit', 'branch', 'deployment', 'deploy',
  'dashboard', 'editor', 'workspace', 'localhost', '127.0.0.1', 'preview', 'builder', 'canvas',
  'design file', 'spreadsheet', 'document', 'proposal', 'requirements', 'kanban', 'sprint',
  'slide', 'slides', 'slide deck', 'deck', 'presentation', 'powerpoint', 'keynote', 'pitch deck',
  'wireframe', 'mockup', 'prototype', 'codex', 'openai', 'chatgpt', 'canva',
]

const SUPPORTING_BROWSER_CONTEXT_KEYWORDS = [
  'docs', 'documentation', 'reference', 'api', 'guide', 'tutorial', 'course', 'lesson', 'research',
  'readme', 'wiki', 'how to', 'how-to', 'spec', 'proposal', 'roadmap', 'planning', 'meeting notes',
  'calendar', 'ticket', 'task', 'backlog', 'discussion', 'assistant', 'prompt', 'email', 'message',
  'slides', 'presentation', 'deck', 'pitch', 'review', 'feedback',
]

const DISTRACTING_BROWSER_CONTEXT_KEYWORDS = [
  'highlights', 'scrim', 'scrims', 'gameplay', 'stream', 'livestream', 'live stream',
  'clip', 'clips', 'reaction', 'prank', 'meme', 'funny', 'trailer', 'vlog', 'podcast clip', 'reel',
  'shorts', 'feed', 'for you', 'discover', 'explore', 'shop', 'shopping', 'sale', 'playlist',
]

const UNCLEAR_BROWSER_CONTEXT_KEYWORDS = [
  'home', 'homepage', 'browse', 'search results', 'search', 'results', 'landing page', 'discover weekly',
]

const PRODUCTIVE_BROWSER_KEYWORDS = [
  'docs', 'documentation', 'reference', 'api', 'guide', 'tutorial', 'course', 'lesson', 'research',
  'stack overflow', 'github', 'notion', 'linear', 'jira', 'figma', 'design system', 'readme',
  'codex', 'chatgpt', 'openai', 'slides', 'powerpoint', 'keynote', 'presentation', 'deck',
]

const PRODUCTIVE_BROWSER_HOST_HINTS = [
  'localhost',
  '127.0.0.1',
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'gitea',
  'vercel.com',
  'netlify.com',
  'railway.app',
  'render.com',
  'fly.io',
  'supabase.com',
  'console.cloud.google.com',
  'portal.azure.com',
  'aws.amazon.com',
  'cloudflare.com',
  'codesandbox.io',
  'stackblitz.com',
  'replit.com',
  'canva.com',
  'sites.google.com',
  'studio.youtube.com',
]

const SUPPORTING_BROWSER_HOST_HINTS = [
  'developer.mozilla.org',
  'mozilla.org',
  'devdocs.io',
  'stackoverflow.com',
  'npmjs.com',
  'pypi.org',
  'docs.google.com',
  'notion.so',
  'coda.io',
  'miro.com',
  'mail.google.com',
  'outlook.live.com',
  'app.slack.com',
  'chat.openai.com',
  'chatgpt.com',
  'openai.com',
  'platform.openai.com',
  'claude.ai',
  'gemini.google.com',
  'perplexity.ai',
  'coursera.org',
  'udemy.com',
  'frontendmasters.com',
  'wikipedia.org',
  'drive.google.com',
  'calendar.google.com',
  'meet.google.com',
  'chat.google.com',
  'keep.google.com',
  'developers.google.com',
  'support.google.com',
  'workspace.google.com',
  'classroom.google.com',
  'notebooklm.google.com',
]

const DISTRACTING_BROWSER_HOST_HINTS = [
  'youtube.com',
  'youtu.be',
  'twitch.tv',
  'tiktok.com',
  'instagram.com',
  'facebook.com',
  'reddit.com',
  'x.com',
  'twitter.com',
  'netflix.com',
  'hulu.com',
  'disneyplus.com',
  'music.youtube.com',
]

const UNCLEAR_BROWSER_HOST_HINTS = [
  'google.com',
  'bing.com',
  'duckduckgo.com',
  'linkedin.com',
]

const PRODUCTIVE_BROWSER_PATH_HINTS = [
  '/pull/',
  '/pulls',
  '/merge_requests',
  '/issues',
  '/compare',
  '/actions',
  '/blob/',
  '/tree/',
  '/edit',
  '/editor',
  '/workspace',
  '/builder',
  '/canvas',
  '/dashboard',
  '/deploy',
  '/deployment',
  '/preview',
  '/project',
  '/board',
]

const SUPPORTING_BROWSER_PATH_HINTS = [
  '/docs',
  '/documentation',
  '/wiki',
  '/reference',
  '/learn',
  '/course',
  '/tutorial',
  '/guide',
  '/guides',
  '/readme',
  '/calendar',
  '/mail',
  '/messages',
]

const DISTRACTING_BROWSER_PATH_HINTS = [
  '/watch',
  '/shorts',
  '/reels',
  '/explore',
  '/feed',
  '/for-you',
  '/foryou',
  '/playlist',
  '/clip',
  '/clips',
  '/live',
  '/browse',
  '/gaming',
  '/shop',
  '/shopping',
]

const UNCLEAR_BROWSER_PATH_HINTS = [
  '/search',
  '/results',
  '/home',
  '/discover',
]

const APP_NAME_ALIASES = [
  { test: /^code(?: - oss)?(?: insiders)?$/i, label: 'VS Code' },
  { test: /^vscode$/i, label: 'VS Code' },
  { test: /^visual studio code$/i, label: 'VS Code' },
  { test: /^cursor$/i, label: 'Cursor' },
  { test: /^codex$/i, label: 'Codex' },
  { test: /^msedge$/i, label: 'Microsoft Edge' },
  { test: /^microsoftedge$/i, label: 'Microsoft Edge' },
  { test: /^chrome$/i, label: 'Google Chrome' },
  { test: /^firefox$/i, label: 'Mozilla Firefox' },
  { test: /^spotifymusic$/i, label: 'Spotify' },
  { test: /^zunemusic$/i, label: 'Music' },
  { test: /^groovemusic$/i, label: 'Music' },
  { test: /^youtubemusic$/i, label: 'YouTube Music' },
  { test: /^winword$/i, label: 'Microsoft Word' },
  { test: /^word$/i, label: 'Microsoft Word' },
  { test: /^powerpnt$/i, label: 'Microsoft PowerPoint' },
  { test: /^excel$/i, label: 'Microsoft Excel' },
  { test: /^whatsapp$/i, label: 'WhatsApp' },
  { test: /^snippingtool$/i, label: 'Snipping Tool' },
  { test: /^explorer$/i, label: 'Windows Explorer' },
  { test: /^notepad$/i, label: 'Notepad' },
]


// ─── Extended domain knowledge ────────────────────────────────────────────────
// O(1) lookup by exact hostname (www. already stripped by normalizeBrowserUrl).
// Only domains NOT already covered by BROWSER_RULES above.
const EXTENDED_DOMAIN_KNOWLEDGE = {
  // Language / runtime docs
  'rust-lang.org':            { category: 'Development', subcategory: 'Language Docs',    lane: 'supporting', confidence: 0.92 },
  'go.dev':                   { category: 'Development', subcategory: 'Language Docs',    lane: 'supporting', confidence: 0.92 },
  'golang.org':               { category: 'Development', subcategory: 'Language Docs',    lane: 'supporting', confidence: 0.92 },
  'python.org':               { category: 'Development', subcategory: 'Language Docs',    lane: 'supporting', confidence: 0.92 },
  'ruby-lang.org':            { category: 'Development', subcategory: 'Language Docs',    lane: 'supporting', confidence: 0.92 },
  'php.net':                  { category: 'Development', subcategory: 'Language Docs',    lane: 'supporting', confidence: 0.92 },
  'kotlinlang.org':           { category: 'Development', subcategory: 'Language Docs',    lane: 'supporting', confidence: 0.92 },
  'swift.org':                { category: 'Development', subcategory: 'Language Docs',    lane: 'supporting', confidence: 0.92 },
  'typescriptlang.org':       { category: 'Development', subcategory: 'Language Docs',    lane: 'supporting', confidence: 0.93 },
  'elixir-lang.org':          { category: 'Development', subcategory: 'Language Docs',    lane: 'supporting', confidence: 0.90 },
  'haskell.org':              { category: 'Development', subcategory: 'Language Docs',    lane: 'supporting', confidence: 0.90 },
  'scala-lang.org':           { category: 'Development', subcategory: 'Language Docs',    lane: 'supporting', confidence: 0.90 },
  'julialang.org':            { category: 'Development', subcategory: 'Language Docs',    lane: 'supporting', confidence: 0.90 },
  'nodejs.org':               { category: 'Development', subcategory: 'Runtime Docs',     lane: 'supporting', confidence: 0.92 },
  'deno.land':                { category: 'Development', subcategory: 'Runtime Docs',     lane: 'supporting', confidence: 0.92 },
  'bun.sh':                   { category: 'Development', subcategory: 'Runtime Docs',     lane: 'supporting', confidence: 0.92 },
  // Framework / library docs
  'react.dev':                { category: 'Development', subcategory: 'Framework Docs',   lane: 'supporting', confidence: 0.94 },
  'reactjs.org':              { category: 'Development', subcategory: 'Framework Docs',   lane: 'supporting', confidence: 0.93 },
  'vuejs.org':                { category: 'Development', subcategory: 'Framework Docs',   lane: 'supporting', confidence: 0.93 },
  'nuxt.com':                 { category: 'Development', subcategory: 'Framework Docs',   lane: 'supporting', confidence: 0.92 },
  'nextjs.org':               { category: 'Development', subcategory: 'Framework Docs',   lane: 'supporting', confidence: 0.93 },
  'svelte.dev':               { category: 'Development', subcategory: 'Framework Docs',   lane: 'supporting', confidence: 0.93 },
  'angular.io':               { category: 'Development', subcategory: 'Framework Docs',   lane: 'supporting', confidence: 0.92 },
  'expressjs.com':            { category: 'Development', subcategory: 'Framework Docs',   lane: 'supporting', confidence: 0.92 },
  'nestjs.com':               { category: 'Development', subcategory: 'Framework Docs',   lane: 'supporting', confidence: 0.92 },
  'djangoproject.com':        { category: 'Development', subcategory: 'Framework Docs',   lane: 'supporting', confidence: 0.92 },
  'flask.palletsprojects.com':{ category: 'Development', subcategory: 'Framework Docs',   lane: 'supporting', confidence: 0.92 },
  'fastapi.tiangolo.com':     { category: 'Development', subcategory: 'Framework Docs',   lane: 'supporting', confidence: 0.92 },
  'laravel.com':              { category: 'Development', subcategory: 'Framework Docs',   lane: 'supporting', confidence: 0.92 },
  'spring.io':                { category: 'Development', subcategory: 'Framework Docs',   lane: 'supporting', confidence: 0.92 },
  'docs.rs':                  { category: 'Development', subcategory: 'Rust Docs',        lane: 'supporting', confidence: 0.94 },
  // CSS / UI libraries
  'tailwindcss.com':          { category: 'Development', subcategory: 'CSS Framework',    lane: 'supporting', confidence: 0.93 },
  'getbootstrap.com':         { category: 'Development', subcategory: 'CSS Framework',    lane: 'supporting', confidence: 0.92 },
  'mui.com':                  { category: 'Development', subcategory: 'UI Library',       lane: 'supporting', confidence: 0.92 },
  'chakra-ui.com':            { category: 'Development', subcategory: 'UI Library',       lane: 'supporting', confidence: 0.92 },
  'radix-ui.com':             { category: 'Development', subcategory: 'UI Library',       lane: 'supporting', confidence: 0.92 },
  'ui.shadcn.com':            { category: 'Development', subcategory: 'UI Library',       lane: 'supporting', confidence: 0.93 },
  'ant.design':               { category: 'Development', subcategory: 'UI Library',       lane: 'supporting', confidence: 0.92 },
  'storybook.js.org':         { category: 'Development', subcategory: 'UI Development',   lane: 'productive', confidence: 0.92 },
  // Build tools / package managers
  'vite.dev':                 { category: 'Development', subcategory: 'Build Tool',       lane: 'supporting', confidence: 0.92 },
  'vitejs.dev':               { category: 'Development', subcategory: 'Build Tool',       lane: 'supporting', confidence: 0.92 },
  'webpack.js.org':           { category: 'Development', subcategory: 'Build Tool',       lane: 'supporting', confidence: 0.92 },
  'yarnpkg.com':              { category: 'Development', subcategory: 'Package Manager',  lane: 'supporting', confidence: 0.92 },
  'pnpm.io':                  { category: 'Development', subcategory: 'Package Manager',  lane: 'supporting', confidence: 0.92 },
  // Dev utilities
  'regex101.com':             { category: 'Development', subcategory: 'Dev Tool',         lane: 'productive', confidence: 0.93 },
  'regexr.com':               { category: 'Development', subcategory: 'Dev Tool',         lane: 'productive', confidence: 0.93 },
  'jsfiddle.net':             { category: 'Development', subcategory: 'Online Sandbox',   lane: 'productive', confidence: 0.91 },
  'caniuse.com':              { category: 'Development', subcategory: 'Compatibility',    lane: 'supporting', confidence: 0.93 },
  'bundlephobia.com':         { category: 'Development', subcategory: 'Bundle Analysis',  lane: 'supporting', confidence: 0.91 },
  'jwt.io':                   { category: 'Development', subcategory: 'Auth Tool',        lane: 'productive', confidence: 0.93 },
  'httpbin.org':              { category: 'Development', subcategory: 'API Testing',      lane: 'productive', confidence: 0.91 },
  'ngrok.com':                { category: 'Development', subcategory: 'Tunnel Tool',      lane: 'productive', confidence: 0.91 },
  'excalidraw.com':           { category: 'Development', subcategory: 'Whiteboard',       lane: 'productive', confidence: 0.90 },
  'app.diagrams.net':         { category: 'Development', subcategory: 'Diagramming',      lane: 'productive', confidence: 0.91 },
  'draw.io':                  { category: 'Development', subcategory: 'Diagramming',      lane: 'productive', confidence: 0.91 },
  'mermaid.live':             { category: 'Development', subcategory: 'Diagramming',      lane: 'productive', confidence: 0.91 },
  'dbdiagram.io':             { category: 'Development', subcategory: 'DB Design',        lane: 'productive', confidence: 0.92 },
  'readme.com':               { category: 'Development', subcategory: 'Documentation',    lane: 'productive', confidence: 0.90 },
  'gitbook.com':              { category: 'Development', subcategory: 'Documentation',    lane: 'productive', confidence: 0.90 },
  // CI / monitoring
  'circleci.com':             { category: 'Development', subcategory: 'CI/CD',            lane: 'productive', confidence: 0.92 },
  'sentry.io':                { category: 'Development', subcategory: 'Error Monitoring', lane: 'productive', confidence: 0.93 },
  'app.datadoghq.com':        { category: 'Development', subcategory: 'Observability',    lane: 'productive', confidence: 0.92 },
  'grafana.com':              { category: 'Development', subcategory: 'Monitoring',       lane: 'productive', confidence: 0.90 },
  'app.posthog.com':          { category: 'Development', subcategory: 'Analytics',        lane: 'productive', confidence: 0.92 },
  'mixpanel.com':             { category: 'Development', subcategory: 'Analytics',        lane: 'productive', confidence: 0.88 },
  // Extra cloud / hosting
  'digitalocean.com':         { category: 'Development', subcategory: 'Cloud Hosting',    lane: 'productive', confidence: 0.88 },
  'hetzner.com':              { category: 'Development', subcategory: 'Cloud Hosting',    lane: 'productive', confidence: 0.88 },
  'terraform.io':             { category: 'Development', subcategory: 'Infrastructure',   lane: 'productive', confidence: 0.91 },
  // AI / code assistants not in BROWSER_RULES
  'phind.com':                { category: 'AI Tools', subcategory: 'AI Search',           lane: 'supporting', confidence: 0.91 },
  'you.com':                  { category: 'AI Tools', subcategory: 'AI Search',           lane: 'supporting', confidence: 0.88 },
  'copilot.github.com':       { category: 'AI Tools', subcategory: 'Code Assistant',      lane: 'productive', confidence: 0.93 },
  'tabnine.com':              { category: 'AI Tools', subcategory: 'Code Assistant',      lane: 'productive', confidence: 0.91 },
  'codeium.com':              { category: 'AI Tools', subcategory: 'Code Assistant',      lane: 'productive', confidence: 0.91 },
  'cursor.sh':                { category: 'AI Tools', subcategory: 'Code Assistant',      lane: 'productive', confidence: 0.93 },
  'wandb.ai':                 { category: 'AI Tools', subcategory: 'ML Experiments',      lane: 'productive', confidence: 0.92 },
  // Design
  'lucidchart.com':           { category: 'Design', subcategory: 'Diagramming',           lane: 'productive', confidence: 0.90 },
  'whimsical.com':            { category: 'Design', subcategory: 'Wireframing',           lane: 'productive', confidence: 0.90 },
  'spline.design':            { category: 'Design', subcategory: '3D Design',             lane: 'productive', confidence: 0.91 },
  'coolors.co':               { category: 'Design', subcategory: 'Color Palette',         lane: 'productive', confidence: 0.91 },
  'fonts.google.com':         { category: 'Design', subcategory: 'Typography',            lane: 'supporting', confidence: 0.91 },
  'fontawesome.com':          { category: 'Design', subcategory: 'Icon Library',          lane: 'supporting', confidence: 0.91 },
  'unsplash.com':             { category: 'Design', subcategory: 'Stock Photos',          lane: 'supporting', confidence: 0.82 },
  'pexels.com':               { category: 'Design', subcategory: 'Stock Photos',          lane: 'supporting', confidence: 0.82 },
  'icons8.com':               { category: 'Design', subcategory: 'Icons',                 lane: 'supporting', confidence: 0.88 },
  'flaticon.com':             { category: 'Design', subcategory: 'Icons',                 lane: 'supporting', confidence: 0.88 },
  'dribbble.com':             { category: 'Design', subcategory: 'Design Inspiration',    lane: 'supporting', confidence: 0.80 },
  'behance.net':              { category: 'Design', subcategory: 'Design Portfolio',      lane: 'supporting', confidence: 0.80 },
  'adobe.com':                { category: 'Design', subcategory: 'Creative Suite',        lane: 'productive', confidence: 0.85 },
  // Learning
  'codecademy.com':           { category: 'Learning', subcategory: 'Interactive Coding',  lane: 'supporting', confidence: 0.93 },
  'brilliant.org':            { category: 'Learning', subcategory: 'STEM Learning',       lane: 'supporting', confidence: 0.93 },
  'edx.org':                  { category: 'Learning', subcategory: 'Online Course',       lane: 'supporting', confidence: 0.93 },
  'w3schools.com':            { category: 'Learning', subcategory: 'Web Dev Reference',   lane: 'supporting', confidence: 0.88 },
  'geeksforgeeks.org':        { category: 'Learning', subcategory: 'CS Education',        lane: 'supporting', confidence: 0.88 },
  'tutorialspoint.com':       { category: 'Learning', subcategory: 'Tech Tutorials',      lane: 'supporting', confidence: 0.87 },
  'leetcode.com':             { category: 'Development', subcategory: 'Algorithm Practice',lane: 'productive', confidence: 0.92 },
  'hackerrank.com':           { category: 'Development', subcategory: 'Coding Practice',  lane: 'productive', confidence: 0.92 },
  'codewars.com':             { category: 'Development', subcategory: 'Coding Practice',  lane: 'productive', confidence: 0.92 },
  'adventofcode.com':         { category: 'Development', subcategory: 'Coding Challenge', lane: 'productive', confidence: 0.90 },
  'roadmap.sh':               { category: 'Learning', subcategory: 'Dev Roadmap',         lane: 'supporting', confidence: 0.91 },
  'javascript.info':          { category: 'Learning', subcategory: 'JS Deep Dive',        lane: 'supporting', confidence: 0.93 },
  'web.dev':                  { category: 'Learning', subcategory: 'Web Dev Reference',   lane: 'supporting', confidence: 0.93 },
  'realpython.com':           { category: 'Learning', subcategory: 'Python Tutorials',    lane: 'supporting', confidence: 0.90 },
  'masterclass.com':          { category: 'Learning', subcategory: 'Expert Courses',      lane: 'supporting', confidence: 0.88 },
  'skillshare.com':           { category: 'Learning', subcategory: 'Creative Skills',     lane: 'supporting', confidence: 0.87 },
  'arxiv.org':                { category: 'Learning', subcategory: 'Research Papers',     lane: 'supporting', confidence: 0.92 },
  'scholar.google.com':       { category: 'Learning', subcategory: 'Academic Search',     lane: 'supporting', confidence: 0.92 },
  'researchgate.net':         { category: 'Learning', subcategory: 'Academic Network',    lane: 'supporting', confidence: 0.88 },
  'ocw.mit.edu':              { category: 'Learning', subcategory: 'University Course',   lane: 'supporting', confidence: 0.94 },
  'javascript.info':          { category: 'Learning', subcategory: 'JS Reference',        lane: 'supporting', confidence: 0.92 },
  // Work tools
  'zapier.com':               { category: 'Project Mgmt', subcategory: 'Automation',      lane: 'supporting', confidence: 0.88 },
  'make.com':                 { category: 'Project Mgmt', subcategory: 'Automation',      lane: 'supporting', confidence: 0.88 },
  'calendly.com':             { category: 'Communication', subcategory: 'Scheduling',     lane: 'supporting', confidence: 0.91 },
  'grammarly.com':            { category: 'Writing', subcategory: 'Writing Assistant',    lane: 'productive', confidence: 0.90 },
  'typefully.com':            { category: 'Writing', subcategory: 'Content Creator',      lane: 'productive', confidence: 0.88 },
  // Tech news / reading
  'arstechnica.com':          { category: 'Reading', subcategory: 'Tech News',            lane: 'supporting', confidence: 0.78 },
  'wired.com':                { category: 'Reading', subcategory: 'Tech News',            lane: 'supporting', confidence: 0.75 },
  'bloomberg.com':            { category: 'Reading', subcategory: 'Business News',        lane: 'supporting', confidence: 0.73 },
  'ft.com':                   { category: 'Reading', subcategory: 'Financial News',       lane: 'supporting', confidence: 0.73 },
  'economist.com':            { category: 'Reading', subcategory: 'Business Analysis',    lane: 'supporting', confidence: 0.74 },
  'nytimes.com':              { category: 'Reading', subcategory: 'News',                 lane: 'unclear',    confidence: 0.65 },
  'bbc.com':                  { category: 'Reading', subcategory: 'News',                 lane: 'unclear',    confidence: 0.65 },
  'cnn.com':                  { category: 'Reading', subcategory: 'News',                 lane: 'unclear',    confidence: 0.62 },
  // Extra streaming / entertainment
  'tv.apple.com':             { category: 'Entertainment', subcategory: 'Streaming',      lane: 'distracting', confidence: 0.96 },
  'max.com':                  { category: 'Entertainment', subcategory: 'Streaming',      lane: 'distracting', confidence: 0.96 },
  'soundcloud.com':           { category: 'Entertainment', subcategory: 'Music Streaming',lane: 'distracting', confidence: 0.88 },
  'bandcamp.com':             { category: 'Entertainment', subcategory: 'Music Platform', lane: 'distracting', confidence: 0.84 },
  'open.spotify.com':         { category: 'Entertainment', subcategory: 'Music Streaming',lane: 'distracting', confidence: 0.90 },
  'music.apple.com':          { category: 'Entertainment', subcategory: 'Music Streaming',lane: 'distracting', confidence: 0.90 },
  'chess.com':                { category: 'Entertainment', subcategory: 'Gaming',         lane: 'distracting', confidence: 0.91 },
  'lichess.org':              { category: 'Entertainment', subcategory: 'Gaming',         lane: 'distracting', confidence: 0.91 },
  'poki.com':                 { category: 'Entertainment', subcategory: 'Browser Games',  lane: 'distracting', confidence: 0.97 },
  'miniclip.com':             { category: 'Entertainment', subcategory: 'Browser Games',  lane: 'distracting', confidence: 0.97 },
  '9gag.com':                 { category: 'Entertainment', subcategory: 'Memes',          lane: 'distracting', confidence: 0.96 },
  'imgur.com':                { category: 'Entertainment', subcategory: 'Image Sharing',  lane: 'distracting', confidence: 0.88 },
  'giphy.com':                { category: 'Entertainment', subcategory: 'GIFs',           lane: 'distracting', confidence: 0.91 },
  'buzzfeed.com':             { category: 'Entertainment', subcategory: 'Viral Content',  lane: 'distracting', confidence: 0.95 },
  'tumblr.com':               { category: 'Social Media', subcategory: 'Blog Platform',   lane: 'distracting', confidence: 0.90 },
  'pinterest.com':            { category: 'Social Media', subcategory: 'Visual Discovery',lane: 'unclear',     confidence: 0.72 },
  // Extra shopping
  'walmart.com':              { category: 'Shopping', subcategory: 'E-Commerce',          lane: 'distracting', confidence: 0.95 },
  'target.com':               { category: 'Shopping', subcategory: 'E-Commerce',          lane: 'distracting', confidence: 0.95 },
  'bestbuy.com':              { category: 'Shopping', subcategory: 'Electronics',         lane: 'distracting', confidence: 0.93 },
  'newegg.com':               { category: 'Shopping', subcategory: 'Electronics',         lane: 'distracting', confidence: 0.93 },
  'flipkart.com':             { category: 'Shopping', subcategory: 'E-Commerce',          lane: 'distracting', confidence: 0.95 },
  'myntra.com':               { category: 'Shopping', subcategory: 'Fashion',             lane: 'distracting', confidence: 0.95 },
}

// ─── Subdomain signals ────────────────────────────────────────────────────────
const PRODUCTIVE_SUBDOMAIN_SIGNALS = new Set([
  'api', 'app', 'console', 'admin', 'dashboard', 'dev', 'studio',
  'playground', 'sandbox', 'editor', 'builder', 'deploy', 'cloud',
])
const SUPPORTING_SUBDOMAIN_SIGNALS = new Set([
  'docs', 'doc', 'documentation', 'help', 'support', 'learn', 'learning',
  'wiki', 'kb', 'knowledge', 'forum', 'community', 'blog', 'status',
  'changelog', 'guide', 'guides', 'tutorial', 'academy', 'courses',
])
const DISTRACTING_SUBDOMAIN_SIGNALS = new Set([
  'play', 'game', 'games', 'stream', 'tv', 'video', 'watch', 'shop', 'store',
])

// ─── TLD signals ─────────────────────────────────────────────────────────────
const EDUCATIONAL_TLD_PATTERNS = [/\.edu$/i, /\.ac\.[a-z]{2}$/i, /\.edu\.[a-z]{2}$/i]
const GOVERNMENT_TLD_PATTERNS  = [/\.gov$/i, /\.gov\.[a-z]{2}$/i, /\.mil$/i, /\.gc\.ca$/i]

// ─── Window-title file-extension signals ─────────────────────────────────────
const CODE_FILE_EXTENSIONS = new Set([
  '.py','.js','.ts','.jsx','.tsx','.go','.rs','.rb','.java','.cpp','.c',
  '.cs','.php','.sql','.sh','.bash','.zsh','.yaml','.yml','.json','.xml',
  '.html','.css','.scss','.less','.vue','.svelte','.swift','.kt','.dart',
  '.r','.lua','.pl','.ex','.exs','.clj','.hs','.toml','.ini','.env',
])
const DOCUMENT_FILE_EXTENSIONS = new Set([
  '.doc','.docx','.xls','.xlsx','.ppt','.pptx','.pdf',
  '.pages','.numbers','.key','.odt','.ods','.odp','.txt','.rtf','.csv',
  '.md','.mdx',
])
const MEDIA_FILE_EXTENSIONS = new Set([
  '.mp4','.mp3','.mkv','.avi','.mov','.wav','.flac','.ogg','.m4a','.webm',
])
const PRODUCTIVE_TITLE_KEYWORDS = [
  'pull request', 'merge request', 'code review', 'pr #', 'issue #',
  'report', 'proposal', 'requirements', 'roadmap', 'budget', 'contract',
  'invoice', 'design doc', 'rfc', 'prd', 'standup', 'sprint', 'retrospective',
  'backlog', 'kanban',
]

// ─── Extended classification helpers ─────────────────────────────────────────

function findExtendedDomainRule(host = '') {
  if (!host) return null
  if (EXTENDED_DOMAIN_KNOWLEDGE[host]) return EXTENDED_DOMAIN_KNOWLEDGE[host]
  // Fallback to root domain (strips one subdomain level)
  const parts = host.split('.')
  if (parts.length > 2) {
    const root = parts.slice(-2).join('.')
    if (EXTENDED_DOMAIN_KNOWLEDGE[root]) return EXTENDED_DOMAIN_KNOWLEDGE[root]
  }
  return null
}

function classifyBySubdomain(host = '') {
  if (!host) return null
  const parts = host.split('.')
  if (parts.length < 3) return null
  const sub = parts[0].toLowerCase()
  if (sub === 'www') return null
  if (PRODUCTIVE_SUBDOMAIN_SIGNALS.has(sub))   return { lane: 'productive',  confidence: 0.72 }
  if (SUPPORTING_SUBDOMAIN_SIGNALS.has(sub))   return { lane: 'supporting',  confidence: 0.74 }
  if (DISTRACTING_SUBDOMAIN_SIGNALS.has(sub))  return { lane: 'distracting', confidence: 0.72 }
  return null
}

function classifyByTLD(host = '') {
  if (!host) return null
  if (EDUCATIONAL_TLD_PATTERNS.some((re) => re.test(host))) {
    return { category: 'Learning', subcategory: 'Educational Resource', lane: 'supporting', confidence: 0.80 }
  }
  if (GOVERNMENT_TLD_PATTERNS.some((re) => re.test(host))) {
    return { category: 'Reading', subcategory: 'Government Resource', lane: 'supporting', confidence: 0.76 }
  }
  return null
}

function classifyByWindowTitleSignals(windowTitle = '') {
  if (!windowTitle) return null
  const lower = windowTitle.toLowerCase().trim()
  // File extension detection (e.g. "main.ts — VS Code")
  const extMatch = lower.match(/\.([a-z0-9]+)(?:\s|$|—|-|\||·)/)
  if (extMatch) {
    const ext = `.${extMatch[1]}`
    if (CODE_FILE_EXTENSIONS.has(ext))     return { category: 'Development', subcategory: 'Code File',    lane: 'productive',  confidence: 0.85 }
    if (DOCUMENT_FILE_EXTENSIONS.has(ext)) return { category: 'Writing',     subcategory: 'Document',      lane: 'productive',  confidence: 0.82 }
    if (MEDIA_FILE_EXTENSIONS.has(ext))    return { category: 'Entertainment',subcategory: 'Media File',   lane: 'distracting', confidence: 0.80 }
  }
  // Keyword signals
  if (PRODUCTIVE_TITLE_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { category: 'Writing', subcategory: 'Work Document', lane: 'productive', confidence: 0.76 }
  }
  return null
}

export const CATEGORY_COLORS = {
  Development: '#00B4D8',
  Design: '#F59E0B',
  Writing: '#52B788',
  Communication: '#9B51E0',
  'Project Mgmt': '#6B5CE7',
  'AI Tools': '#6B5CE7',
  Music: '#1DB954',
  Entertainment: '#EF4444',
  'Social Media': '#EC4899',
  Learning: '#52B788',
  Reading: '#F59E0B',
  Shopping: '#F59E0B',
  System: '#8E95A3',
  Browser: '#9B51E0',
  Other: '#8E95A3',
  Unknown: '#8E95A3',
}

const SUPPORTING_CATEGORIES = new Set([
  'Communication',
  'Project Mgmt',
  'AI Tools',
  'Music',
  'Reading',
  'Learning',
])

const DISTRACTING_CATEGORIES = new Set([
  'Entertainment',
  'Social Media',
  'Shopping',
])

const SUPPORTING_SUBCATEGORY_HINTS = [
  'doc',
  'research',
  'plan',
  'message',
  'email',
  'calendar',
  'launcher',
  'security',
  'utility',
  'file manager',
  'course',
  'tutorial',
  'audio',
  'assistant',
]

const SUPPORTING_CONTEXT_HINTS = [
  'docs',
  'documentation',
  'reference',
  'setup',
  'planning',
  'calendar',
  'reading',
  'research',
  'email',
  'message',
  'slides',
  'presentation',
  'deck',
  'pitch',
  'assistant',
  'prompt',
]

const PRODUCTIVE_PRESENTATION_HINTS = [
  'slides',
  'slide deck',
  'deck',
  'presentation',
  'powerpoint',
  'keynote',
  'google slides',
  'pitch deck',
]

const PRODUCTIVE_DESIGN_HINTS = [
  'design',
  'mockup',
  'wireframe',
  'prototype',
  'figma',
  'canva',
  'ui',
  'ux',
]

const PRODUCTIVE_AI_HINTS = [
  'codex',
  'chatgpt',
  'openai',
  'prompt',
  'assistant',
]

const UNCLEAR_CATEGORIES = new Set(['Other', 'Unknown', 'Browser'])

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0))
}

function titleCaseLabel(value = '') {
  return value
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
}

function normalizeMatchText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function includesAny(text = '', keywords = []) {
  return keywords.some((keyword) => text.includes(String(keyword).toLowerCase()))
}

function countKeywordMatches(text = '', keywords = []) {
  return keywords.reduce((sum, keyword) => (
    text.includes(String(keyword).toLowerCase()) ? sum + 1 : sum
  ), 0)
}

function countHostMatches(host = '', keywords = []) {
  const normalizedHost = String(host || '').trim().toLowerCase()
  if (!normalizedHost) return 0

  return keywords.reduce((sum, keyword) => {
    const normalizedKeyword = String(keyword || '').trim().toLowerCase()
    if (!normalizedKeyword) return sum
    if (normalizedHost === normalizedKeyword) return sum + 1
    if (normalizedHost.endsWith(`.${normalizedKeyword}`)) return sum + 1
    if (normalizedKeyword.includes('.') && normalizedHost.includes(normalizedKeyword)) return sum + 1
    return sum
  }, 0)
}

function countPathMatches(path = '', href = '', keywords = []) {
  const source = `${path} ${href}`.toLowerCase()
  return keywords.reduce((sum, keyword) => (
    source.includes(String(keyword).toLowerCase()) ? sum + 1 : sum
  ), 0)
}

function isBrowserAppName(appName = '') {
  const normalizedApp = String(appName || '').trim().toLowerCase()
  return BROWSER_APPS.some((browser) => normalizedApp.includes(String(browser).toLowerCase()))
}

export function isBrowserShellRuleMatch(matchText = '') {
  const normalizedMatch = normalizeMatchText(matchText)
  if (!normalizedMatch) return false
  return BROWSER_APPS.some((browser) => normalizeMatchText(browser) === normalizedMatch)
}

function isGoogleSearchHost(host = '') {
  return /^google\.[a-z.]+$/i.test(String(host || '').trim())
}

function isGoogleSearchPath(path = '') {
  const normalizedPath = String(path || '').trim().toLowerCase()
  return !normalizedPath || normalizedPath === '/' || normalizedPath === '/search' || normalizedPath === '/webhp'
}

function classifyGoogleSearchContext(base = {}, browserSource = '', normalizedUrl = {}) {
  if (!isGoogleSearchHost(normalizedUrl.host) || !isGoogleSearchPath(normalizedUrl.path)) return null

  const searchSource = `${browserSource} ${normalizedUrl.queryText || ''}`.trim()
  const productiveHits =
    countKeywordMatches(searchSource, GOOGLE_SEARCH_PRODUCTIVE_KEYWORDS) +
    countKeywordMatches(searchSource, PRODUCTIVE_BROWSER_CONTEXT_KEYWORDS) +
    countKeywordMatches(searchSource, PRODUCTIVE_BROWSER_KEYWORDS)
  const supportingHits = countKeywordMatches(searchSource, SUPPORTING_BROWSER_CONTEXT_KEYWORDS)
  const distractingHits =
    countKeywordMatches(searchSource, GOOGLE_SEARCH_DISTRACTING_KEYWORDS) +
    countKeywordMatches(searchSource, DISTRACTING_BROWSER_CONTEXT_KEYWORDS) +
    countKeywordMatches(searchSource, YOUTUBE_DISTRACTING_KEYWORDS)

  if ((productiveHits + supportingHits) > distractingHits && (productiveHits + supportingHits) > 0) {
    return buildBrowserClassification(base, {
      category: productiveHits >= 2 ? 'Development' : 'Reading',
      subcategory: productiveHits >= 2 ? 'Research Search' : 'Reference Search',
      color: productiveHits >= 2 ? CATEGORY_COLORS.Development : CATEGORY_COLORS.Reading,
      productive: true,
      lane: 'supporting',
      confidence: normalizedUrl.queryText ? 0.9 : 0.82,
    })
  }

  if (distractingHits > productiveHits && distractingHits > supportingHits) {
    return buildBrowserClassification(base, {
      category: 'Entertainment',
      subcategory: 'Entertainment Search',
      color: CATEGORY_COLORS.Entertainment,
      productive: false,
      lane: 'distracting',
      confidence: normalizedUrl.queryText ? 0.91 : 0.82,
    })
  }

  return buildBrowserClassification(base, {
    category: 'Browser',
    subcategory: 'General Search',
    color: CATEGORY_COLORS.Browser,
    productive: null,
    lane: 'unclear',
    confidence: normalizedUrl.queryText ? 0.68 : 0.56,
  })
}

function classifyYouTubeContext(base = {}, browserSource = '', normalizedUrl = {}) {
  const host = String(normalizedUrl.host || '')
  const path = String(normalizedUrl.path || '')
  const isYouTube = host.includes('youtube.com') || host.includes('youtu.be') || browserSource.includes('youtube')
  if (!isYouTube || host.includes('studio.youtube.com')) return null

  if (host.includes('music.youtube.com')) {
    return buildBrowserClassification(base, {
      category: 'Entertainment',
      subcategory: 'Music Streaming',
      color: CATEGORY_COLORS.Entertainment,
      productive: false,
      lane: 'distracting',
      confidence: host ? 0.97 : 0.9,
    })
  }

  const instructionalHits =
    countKeywordMatches(browserSource, YOUTUBE_PRODUCTIVE_KEYWORDS)
  const distractingHits =
    countKeywordMatches(browserSource, YOUTUBE_DISTRACTING_KEYWORDS) +
    countKeywordMatches(browserSource, MEDIA_DISTRACTING_KEYWORDS) +
    countKeywordMatches(browserSource, DISTRACTING_BROWSER_CONTEXT_KEYWORDS)
  const isWatchPage = path.startsWith('/watch') || path.startsWith('/live')
  const isSearchPage = path.startsWith('/results')
  const isShortsPage = path.startsWith('/shorts')
  const isPlaylistPage = path.startsWith('/playlist')
  const isFeedPage = path.startsWith('/feed') || path.startsWith('/browse')

  const hasExplicitLearningIntent = includesAny(browserSource, [
    'tutorial',
    'course',
    'lesson',
    'lecture',
    'how to',
    'learn',
    'learning',
    'bootcamp',
    'workshop',
    'study',
    'revision',
    'from scratch',
  ])

  if (isSearchPage) {
    if ((instructionalHits > 0 || hasExplicitLearningIntent) && instructionalHits > distractingHits) {
      return buildBrowserClassification(base, {
        category: 'Learning',
        subcategory: 'Learning Search',
        color: CATEGORY_COLORS.Learning,
        productive: true,
        lane: 'supporting',
        confidence: normalizedUrl.host ? 0.9 : 0.8,
      })
    }

    if (distractingHits > instructionalHits) {
      return buildBrowserClassification(base, {
        category: 'Entertainment',
        subcategory: 'Entertainment Search',
        color: CATEGORY_COLORS.Entertainment,
        productive: false,
        lane: 'distracting',
        confidence: normalizedUrl.host ? 0.9 : 0.8,
      })
    }
  }

  if ((instructionalHits > 0 || hasExplicitLearningIntent) && instructionalHits > distractingHits && !isShortsPage) {
    return buildBrowserClassification(base, {
      category: 'Learning',
      subcategory: isWatchPage || isPlaylistPage ? 'Instructional Video' : 'Learning Channel',
      color: CATEGORY_COLORS.Learning,
      productive: true,
      lane: 'supporting',
      confidence: normalizedUrl.host ? 0.95 : 0.86,
    })
  }

  if (isShortsPage || distractingHits > 0 || isWatchPage || isPlaylistPage || isFeedPage) {
    return buildBrowserClassification(base, {
      category: 'Entertainment',
      subcategory: isShortsPage
        ? 'Short Video'
        : includesAny(browserSource, MEDIA_DISTRACTING_KEYWORDS)
          ? 'Music / Media'
          : 'Video Watching',
      color: CATEGORY_COLORS.Entertainment,
      productive: false,
      lane: 'distracting',
      confidence: normalizedUrl.host ? 0.98 : 0.9,
    })
  }

  return buildBrowserClassification(base, {
    category: 'Entertainment',
    subcategory: 'General Video Watching',
    color: CATEGORY_COLORS.Entertainment,
    productive: false,
    lane: 'distracting',
    confidence: normalizedUrl.host ? 0.9 : 0.76,
  })
}

function deriveProductiveStateFromLane(lane = 'unclear') {
  if (lane === 'productive' || lane === 'supporting') return true
  if (lane === 'distracting') return false
  return null
}

function scoreBrowserLaneEvidence({
  browserSource = '',
  host = '',
  path = '',
  href = '',
  baseLane = 'unclear',
  category = '',
} = {}) {
  const scores = {
    productive: 0,
    supporting: 0,
    unclear: 0,
    distracting: 0,
  }

  const normalizedBaseLane = normalizeLaneKey(baseLane, {
    productive: deriveProductiveStateFromLane(baseLane),
    category,
  })
  scores[normalizedBaseLane] += normalizedBaseLane === 'distracting' ? 3.1 : 2.4

  scores.productive += countHostMatches(host, PRODUCTIVE_BROWSER_HOST_HINTS) * 4.4
  scores.supporting += countHostMatches(host, SUPPORTING_BROWSER_HOST_HINTS) * 4
  scores.distracting += countHostMatches(host, DISTRACTING_BROWSER_HOST_HINTS) * 4.8
  scores.unclear += countHostMatches(host, UNCLEAR_BROWSER_HOST_HINTS) * 3.2

  scores.productive += countPathMatches(path, href, PRODUCTIVE_BROWSER_PATH_HINTS) * 2.4
  scores.supporting += countPathMatches(path, href, SUPPORTING_BROWSER_PATH_HINTS) * 2
  scores.distracting += countPathMatches(path, href, DISTRACTING_BROWSER_PATH_HINTS) * 2.7
  scores.unclear += countPathMatches(path, href, UNCLEAR_BROWSER_PATH_HINTS) * 1.8

  scores.productive += countKeywordMatches(browserSource, PRODUCTIVE_BROWSER_CONTEXT_KEYWORDS) * 1.75
  scores.productive += countKeywordMatches(browserSource, PRODUCTIVE_BROWSER_KEYWORDS) * 1.35
  scores.supporting += countKeywordMatches(browserSource, SUPPORTING_BROWSER_CONTEXT_KEYWORDS) * 1.45
  scores.distracting += countKeywordMatches(browserSource, DISTRACTING_BROWSER_CONTEXT_KEYWORDS) * 1.85
  scores.unclear += countKeywordMatches(browserSource, UNCLEAR_BROWSER_CONTEXT_KEYWORDS) * 1.2

  if (SUPPORTING_CATEGORIES.has(String(category || '').trim())) scores.supporting += 0.85
  if (DISTRACTING_CATEGORIES.has(String(category || '').trim())) scores.distracting += 1.25
  if (String(category || '').trim() === 'Development') scores.productive += 0.9

  return scores
}

function pickLaneFromScores(scores = {}, fallbackLane = 'unclear') {
  const ordered = TRACKING_LANE_KEYS
    .map((lane) => [lane, clampNumber(Number(scores?.[lane] || 0), 0, 100)])
    .sort((left, right) => right[1] - left[1])

  const [topLane, topScore] = ordered[0] || [fallbackLane, 0]
  const secondScore = ordered[1]?.[1] || 0
  const safeFallback = normalizeLaneKey(fallbackLane, {
    productive: deriveProductiveStateFromLane(fallbackLane),
  })

  if (topScore < 2.2) return safeFallback
  if ((topScore - secondScore) < 0.8 && topLane !== safeFallback) return safeFallback
  return topLane
}

function deriveBrowserConfidenceFromScores(scores = {}, fallback = 0.56) {
  const ordered = TRACKING_LANE_KEYS
    .map((lane) => clampNumber(Number(scores?.[lane] || 0), 0, 100))
    .sort((left, right) => right - left)
  const topScore = ordered[0] || 0
  const secondScore = ordered[1] || 0
  const confidence = Number(fallback || 0) + (Math.min(topScore, 8) * 0.035) + (Math.max(0, topScore - secondScore) * 0.03)
  return clampNumber(confidence, Math.max(0.56, Number(fallback || 0)), 0.98)
}

function refineBrowserClassification(base = {}, classification = {}, {
  browserSource = '',
  normalizedUrl = { host: '', path: '', href: '' },
} = {}) {
  const baseLane = normalizeLaneKey(classification.lane, {
    productive: normalizeProvidedProductive(classification.productive),
    category: classification.category,
    subcategory: classification.subcategory,
    confidence: classification.confidence ?? 0.56,
    contextLabel: base.contextLabel,
    appName: base.app,
  })
  const scores = scoreBrowserLaneEvidence({
    browserSource,
    host: normalizedUrl.host,
    path: normalizedUrl.path,
    href: normalizedUrl.href,
    baseLane,
    category: classification.category,
  })
  const refinedLane = pickLaneFromScores(scores, baseLane)
  const refinedConfidence = deriveBrowserConfidenceFromScores(scores, classification.confidence ?? 0.56)

  let category = classification.category || 'Browser'
  let subcategory = classification.subcategory || 'Web Context'
  let color = classification.color || CATEGORY_COLORS.Browser

  if ((category === 'Browser' || category === 'Other') && refinedLane === 'productive') {
    category = 'Development'
    subcategory = 'Work Tool'
    color = CATEGORY_COLORS.Development
  } else if ((category === 'Browser' || category === 'Other') && refinedLane === 'supporting') {
    category = includesAny(browserSource, ['course', 'lesson', 'tutorial', 'lecture', 'learn'])
      ? 'Learning'
      : 'Reading'
    subcategory = category === 'Learning' ? 'Learning Material' : 'Reference / Research'
    color = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.Reading
  } else if ((category === 'Browser' || category === 'Other') && refinedLane === 'distracting') {
    category = 'Entertainment'
    subcategory = 'Casual Browsing'
    color = CATEGORY_COLORS.Entertainment
  }

  return buildBrowserClassification(base, {
    category,
    subcategory,
    color,
    productive: deriveProductiveStateFromLane(refinedLane),
    lane: refinedLane,
    confidence: refinedConfidence,
  })
}

function looksSupportingContext({ category = '', subcategory = '', contextLabel = '', appName = '' } = {}) {
  const categoryLabel = String(category || '').trim()
  const subcategoryLabel = String(subcategory || '').toLowerCase()
  const contextSource = `${contextLabel} ${appName}`.toLowerCase()

  if (SUPPORTING_CATEGORIES.has(categoryLabel)) return true
  if (SUPPORTING_SUBCATEGORY_HINTS.some((hint) => subcategoryLabel.includes(hint))) return true
  return SUPPORTING_CONTEXT_HINTS.some((hint) => contextSource.includes(hint))
}

function normalizeProvidedProductive(value) {
  if (value === null || value === undefined) return null
  return Boolean(value)
}

function buildUnknownClassification(appName = 'Unknown') {
  return {
    category: 'Unknown',
    subcategory: '',
    color: CATEGORY_COLORS.Unknown,
    productive: null,
    app: appName,
    confidence: 0,
    contextLabel: appName,
    isCustom: false,
  }
}

export function findMatchingCustomRule(customRules = {}, sources = [], {
  ignoreBrowserShellRules = false,
} = {}) {
  const normalizedSources = (Array.isArray(sources) ? sources : [sources])
    .map((source) => normalizeMatchText(source))
    .filter(Boolean)

  if (!normalizedSources.length || !customRules || typeof customRules !== 'object') return null

  let bestMatch = null
  for (const [rawMatchText, rawRule] of Object.entries(customRules)) {
    const matchText = normalizeMatchText(rawMatchText)
    if (!matchText) continue
    if (ignoreBrowserShellRules && isBrowserShellRuleMatch(matchText)) continue
    if (!normalizedSources.some((source) => source.includes(matchText))) continue

    if (!bestMatch || matchText.length > bestMatch.matchText.length) {
      bestMatch = {
        matchText,
        rule: rawRule || {},
      }
    }
  }

  return bestMatch
}

export function resolveAmbientEntryLane(entry = {}, {
  honorCustomRule = true,
} = {}) {
  const normalizedLane = normalizeLaneKey(entry?.lane, {
    productive: entry?.productive ?? null,
    category: entry?.category || '',
    subcategory: entry?.subcategory || '',
    confidence: entry?.confidence ?? 0,
    contextLabel: entry?.contextLabel || entry?.browserPage || entry?.title || '',
    appName: entry?.appGroup || entry?.app || entry?.sourceApp || '',
  })

  if (honorCustomRule && entry?.isCustom) return normalizedLane

  const categoryLane = getCategoryDefaultLane(entry?.category || '', {
    productive: entry?.productive ?? null,
    subcategory: entry?.subcategory || '',
    contextLabel: entry?.contextLabel || entry?.browserPage || entry?.title || '',
    appName: entry?.appGroup || entry?.app || entry?.sourceApp || '',
  })

  if (!categoryLane || categoryLane === 'unclear') return normalizedLane
  if (normalizedLane === categoryLane) return normalizedLane

  if (categoryLane === 'distracting') return 'distracting'
  if (categoryLane === 'supporting' && normalizedLane === 'productive') return 'supporting'
  return normalizedLane
}

function buildCustomRuleClassification(base = {}, matchedRule = null, fallbackConfidence = 1) {
  if (!matchedRule?.rule) return null
  const category = matchedRule.rule.category ?? 'Other'
  const subcategory = matchedRule.rule.subcategory ?? ''
  const productive = normalizeProvidedProductive(matchedRule.rule.productive)

  return {
    ...base,
    category,
    subcategory,
    color: matchedRule.rule.color ?? CATEGORY_COLORS[category] ?? CATEGORY_COLORS.Other,
    productive,
    lane: normalizeLaneKey(matchedRule.rule.lane, {
      productive,
      category,
      subcategory,
      confidence: fallbackConfidence,
      contextLabel: base.contextLabel,
      appName: base.app,
    }),
    confidence: fallbackConfidence,
    isCustom: true,
  }
}

function buildBrowserClassification(base = {}, {
  category = 'Browser',
  subcategory = 'Web Context',
  color = CATEGORY_COLORS.Browser,
  productive = null,
  lane = null,
  confidence = 0.62,
} = {}) {
  const normalizedProductive = normalizeProvidedProductive(productive)
  return {
    ...base,
    category,
    subcategory,
    color,
    productive: normalizedProductive,
    lane: normalizeLaneKey(lane, {
      productive: normalizedProductive,
      category,
      subcategory,
      confidence,
      contextLabel: base.contextLabel,
      appName: base.app,
    }),
    confidence,
  }
}

function hasProvidedClassification(entry = {}) {
  return (
    Boolean(entry.category) ||
    Boolean(entry.subcategory) ||
    Boolean(entry.contextLabel) ||
    Boolean(entry.color) ||
    entry.productive === null ||
    entry.productive === true ||
    entry.productive === false ||
    Boolean(entry.lane)
  )
}

export function normalizeObservedAppName(appName = '') {
  const raw = String(appName || '').trim()
  if (!raw) return ''

  const aumidSegment = raw.includes('!')
    ? raw.split('!').filter(Boolean).pop()
    : ''
  const packageSegment = raw.includes('_')
    ? raw.split('_')[0]
    : raw
  const aumidCandidate = String(aumidSegment || packageSegment || raw)
    .split('.')
    .filter(Boolean)
    .pop()
    || raw

  const stripped = String(aumidCandidate || raw)
    .replace(/\.exe$/i, '')
    .replace(/\.root$/i, '')
    .replace(/\s+-\s+insiders$/i, ' Insiders')
    .trim()

  const compact = stripped
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!compact) return raw

  const matchedAlias = APP_NAME_ALIASES.find((entry) => entry.test.test(compact))
  if (matchedAlias) return matchedAlias.label

  if (/[A-Z]/.test(compact) && /[a-z]/.test(compact)) return compact
  if (compact === compact.toUpperCase()) return compact

  return titleCaseLabel(compact.toLowerCase())
}

export function normalizeBrowserUrl(browserUrl = '') {
  if (!browserUrl) return { href: '', host: '', path: '', search: '', queryText: '' }
  try {
    const parsed = new URL(browserUrl)
    const queryText = [
      parsed.searchParams.get('q'),
      parsed.searchParams.get('query'),
      parsed.searchParams.get('search_query'),
      parsed.searchParams.get('search'),
      parsed.searchParams.get('text'),
      parsed.searchParams.get('p'),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .slice(0, 240)
    return {
      href: parsed.href.toLowerCase(),
      host: parsed.hostname.replace(/^www\./, '').toLowerCase(),
      path: parsed.pathname.toLowerCase(),
      search: parsed.search.toLowerCase(),
      queryText,
    }
  } catch {
    return {
      href: String(browserUrl).toLowerCase(),
      host: '',
      path: '',
      search: '',
      queryText: '',
    }
  }
}

export function trimBrowserTitle(windowTitle = '') {
  const separators = [' - ', ' | ', ' • ', ' — ']
  for (const separator of separators) {
    const [head] = String(windowTitle || '').split(separator)
    if (head?.trim()) return head.trim()
  }
  return String(windowTitle || '').trim()
}

export function getBrowserContextLabel(windowTitle = '', browserUrl = '', appName = 'Browser') {
  const normalizedUrl = normalizeBrowserUrl(browserUrl)
  const trimmedTitle = trimBrowserTitle(windowTitle)
  if (normalizedUrl.host) {
    const hostLabel = normalizedUrl.host
      .replace(/^(m|app)\./, '')
      .replace(/\.(com|org|net|io|dev|app|ai|co|gg|tv)$/i, '')
      .replace(/-/g, ' ')
    const titleLabel = trimmedTitle && trimmedTitle.toLowerCase() !== hostLabel.toLowerCase() ? trimmedTitle : ''
    return titleLabel ? `${hostLabel} · ${titleLabel}` : hostLabel
  }
  return trimmedTitle || appName
}

export function getLaneFromProductive(productive) {
  return normalizeLaneKey(null, { productive })
}

export function normalizeLaneKey(lane, {
  productive = null,
  category = '',
  subcategory = '',
  confidence = 0,
  contextLabel = '',
  appName = '',
} = {}) {
  const normalizedLane = String(lane || '').trim().toLowerCase()
  if (normalizedLane === 'supportive') return 'supporting'
  if (TRACKING_LANE_KEYS.includes(normalizedLane)) return normalizedLane

  const categoryDrivenLane = getCategoryDefaultLane(category, {
    productive,
    subcategory,
    contextLabel,
    appName,
  })
  if (categoryDrivenLane === 'distracting') return 'distracting'

  if (productive === false) return 'distracting'

  if (productive === true) {
    return looksSupportingContext({ category, subcategory, contextLabel, appName })
      ? 'supporting'
      : 'productive'
  }

  if (looksSupportingContext({ category, subcategory, contextLabel, appName }) && Number(confidence || 0) >= 0.55) {
    return 'supporting'
  }

  if (UNCLEAR_CATEGORIES.has(String(category || '').trim()) || Number(confidence || 0) < 0.55) {
    return 'unclear'
  }

  return categoryDrivenLane || 'unclear'
}

export function getCategoryDefaultLane(category = '', {
  productive = null,
  subcategory = '',
  contextLabel = '',
  appName = '',
} = {}) {
  const categoryLabel = String(category || '').trim()
  if (!categoryLabel) return 'unclear'

  if (DISTRACTING_CATEGORIES.has(categoryLabel)) return 'distracting'
  if (productive === false) return 'distracting'

  if (productive === true) {
    return looksSupportingContext({ category: categoryLabel, subcategory, contextLabel, appName })
      ? 'supporting'
      : 'productive'
  }

  if (SUPPORTING_CATEGORIES.has(categoryLabel)) return 'supporting'
  if (UNCLEAR_CATEGORIES.has(categoryLabel)) return 'unclear'
  return 'unclear'
}

export function isInternalTrackingActivity(entry = {}) {
  const appName = normalizeObservedAppName(entry?.app || '').toLowerCase()
  const title = String(entry?.title || '').toLowerCase()

  return (
    appName.includes('velance') ||
    (appName === 'electron' && title.includes('velance')) ||
    title.includes('velance app')
  )
}

export function classifyBrowserContext(appName, windowTitle = '', browserUrl = '', customRules = {}) {
  const titleLower = String(windowTitle || '').toLowerCase()
  const normalizedUrl = normalizeBrowserUrl(browserUrl)
  const browserSource = `${titleLower} ${normalizedUrl.host} ${normalizedUrl.path} ${normalizedUrl.queryText || ''} ${normalizedUrl.href}`.trim()
  const contextLabel = getBrowserContextLabel(windowTitle, browserUrl, appName)
  const base = {
    app: appName,
    browserUrl,
    site: normalizedUrl.host || null,
    contextLabel,
    isCustom: false,
  }

  const customRuleMatch = findMatchingCustomRule(customRules, [
    contextLabel,
    windowTitle,
    normalizedUrl.host,
    normalizedUrl.path,
    normalizedUrl.href,
    browserSource,
  ], {
    ignoreBrowserShellRules: true,
  })
  const customClassification = buildCustomRuleClassification(base, customRuleMatch, 1)
  if (customClassification) return customClassification

  // Extended domain knowledge (O(1) lookup)
  if (normalizedUrl.host) {
    const extRule = findExtendedDomainRule(normalizedUrl.host)
    if (extRule) {
      return refineBrowserClassification(base, buildBrowserClassification(base, extRule), { browserSource, normalizedUrl })
    }

    // Subdomain signal (e.g. docs.acme.com → supporting)
    const subHint = classifyBySubdomain(normalizedUrl.host)
    if (subHint) {
      const subCategory = subHint.lane === 'productive' ? 'Development' : subHint.lane === 'distracting' ? 'Entertainment' : 'Reading'
      return refineBrowserClassification(base, buildBrowserClassification(base, {
        category: subCategory,
        subcategory: subHint.lane === 'productive' ? 'Work Tool' : subHint.lane === 'distracting' ? 'Casual Browsing' : 'Reference',
        lane: subHint.lane,
        confidence: subHint.confidence,
      }), { browserSource, normalizedUrl })
    }

    // TLD signal (e.g. university.edu → Learning)
    const tldHint = classifyByTLD(normalizedUrl.host)
    if (tldHint) {
      return refineBrowserClassification(base, buildBrowserClassification(base, tldHint), { browserSource, normalizedUrl })
    }
  }

  const googleSearchClassification = classifyGoogleSearchContext(base, browserSource, normalizedUrl)
  if (googleSearchClassification) return googleSearchClassification

  const youtubeClassification = classifyYouTubeContext(base, browserSource, normalizedUrl)
  if (youtubeClassification) return youtubeClassification

  if (
    includesAny(browserSource, MEDIA_DISTRACTING_KEYWORDS) &&
    !includesAny(browserSource, YOUTUBE_PRODUCTIVE_KEYWORDS) &&
    !includesAny(browserSource, PRODUCTIVE_BROWSER_KEYWORDS)
  ) {
    return buildBrowserClassification(base, {
      category: 'Entertainment',
      subcategory: 'Music / Media',
      color: CATEGORY_COLORS.Entertainment,
      productive: false,
      lane: 'distracting',
      confidence: normalizedUrl.host ? 0.9 : 0.74,
    })
  }

  for (const rule of BROWSER_RULES) {
    if (rule.match.some((keyword) => browserSource.includes(keyword.toLowerCase()))) {
      return refineBrowserClassification(base, buildBrowserClassification(base, {
        ...rule,
        confidence: rule.confidence ?? (normalizedUrl.host ? 0.95 : 0.88),
      }), {
        browserSource,
        normalizedUrl,
      })
    }
  }

  const productiveHits = countKeywordMatches(browserSource, PRODUCTIVE_BROWSER_CONTEXT_KEYWORDS) + countKeywordMatches(browserSource, PRODUCTIVE_BROWSER_KEYWORDS)
  const supportingHits = countKeywordMatches(browserSource, SUPPORTING_BROWSER_CONTEXT_KEYWORDS)
  const distractingHits = countKeywordMatches(browserSource, DISTRACTING_BROWSER_CONTEXT_KEYWORDS)
  const unclearHits = countKeywordMatches(browserSource, UNCLEAR_BROWSER_CONTEXT_KEYWORDS)

  if (productiveHits >= 2) {
    return refineBrowserClassification(base, buildBrowserClassification(base, {
      category: 'Development',
      subcategory: 'Work Tool',
      color: CATEGORY_COLORS.Development,
      productive: true,
      lane: 'productive',
      confidence: normalizedUrl.host ? 0.84 : 0.72,
    }), {
      browserSource,
      normalizedUrl,
    })
  }

  if (supportingHits > 0 && distractingHits === 0) {
    return refineBrowserClassification(base, buildBrowserClassification(base, {
      category: 'Reading',
      subcategory: 'Reference / Research',
      color: CATEGORY_COLORS.Reading,
      productive: true,
      lane: 'supporting',
      confidence: normalizedUrl.host ? 0.78 : 0.68,
    }), {
      browserSource,
      normalizedUrl,
    })
  }

  if (distractingHits > 0 && productiveHits === 0 && supportingHits === 0) {
    return refineBrowserClassification(base, buildBrowserClassification(base, {
      category: 'Entertainment',
      subcategory: 'Casual Browsing',
      color: CATEGORY_COLORS.Entertainment,
      productive: false,
      lane: 'distracting',
      confidence: normalizedUrl.host ? 0.84 : 0.7,
    }), {
      browserSource,
      normalizedUrl,
    })
  }

  if (unclearHits > 0) {
    return refineBrowserClassification(base, buildBrowserClassification(base, {
      category: 'Browser',
      subcategory: 'General Browsing',
      color: CATEGORY_COLORS.Browser,
      productive: null,
      lane: 'unclear',
      confidence: normalizedUrl.host ? 0.58 : 0.5,
    }), {
      browserSource,
      normalizedUrl,
    })
  }

  return refineBrowserClassification(base, buildBrowserClassification(base, {
    category: 'Browser',
    subcategory: normalizedUrl.host ? 'Web Context' : 'Web Browsing',
    color: CATEGORY_COLORS.Browser,
    productive: null,
    lane: 'unclear',
    confidence: normalizedUrl.host ? 0.56 : 0.46,
  }), {
    browserSource,
    normalizedUrl,
  })
}

function classifyWorkContextFallback(normalizedAppName = '', windowTitle = '', browserUrl = '') {
  const combinedSource = `${normalizedAppName} ${windowTitle} ${browserUrl}`.toLowerCase()
  const presentationHits = countKeywordMatches(combinedSource, PRODUCTIVE_PRESENTATION_HINTS)
  const designHits = countKeywordMatches(combinedSource, PRODUCTIVE_DESIGN_HINTS)
  const aiHits = countKeywordMatches(combinedSource, PRODUCTIVE_AI_HINTS)
  const supportingHits = countKeywordMatches(combinedSource, SUPPORTING_BROWSER_CONTEXT_KEYWORDS)
  const distractingHits = countKeywordMatches(combinedSource, DISTRACTING_BROWSER_CONTEXT_KEYWORDS)

  if (presentationHits > 0 && distractingHits === 0) {
    return {
      category: 'Writing',
      subcategory: 'Presentation',
      color: CATEGORY_COLORS.Writing,
      productive: true,
      lane: presentationHits >= 2 || designHits > 0 ? 'productive' : 'supporting',
      app: normalizedAppName,
      confidence: 0.82,
      contextLabel: windowTitle || normalizedAppName,
      isCustom: false,
    }
  }

  if (designHits > 0 && distractingHits === 0) {
    return {
      category: 'Design',
      subcategory: 'Creative',
      color: CATEGORY_COLORS.Design,
      productive: true,
      lane: 'productive',
      app: normalizedAppName,
      confidence: 0.8,
      contextLabel: windowTitle || normalizedAppName,
      isCustom: false,
    }
  }

  if (aiHits > 0 && distractingHits === 0) {
    return {
      category: 'AI Tools',
      subcategory: 'AI Assistant',
      color: CATEGORY_COLORS['AI Tools'],
      productive: true,
      lane: 'supporting',
      app: normalizedAppName,
      confidence: 0.78,
      contextLabel: windowTitle || normalizedAppName,
      isCustom: false,
    }
  }

  if (supportingHits >= 2 && distractingHits === 0) {
    return {
      category: 'Reading',
      subcategory: 'Reference / Research',
      color: CATEGORY_COLORS.Reading,
      productive: true,
      lane: 'supporting',
      app: normalizedAppName,
      confidence: 0.72,
      contextLabel: windowTitle || normalizedAppName,
      isCustom: false,
    }
  }

  return null
}

export function classifyActivity(appName, windowTitle = '', browserUrl = '', customRules = {}) {
  const normalizedAppName = normalizeObservedAppName(appName)
  if (!normalizedAppName || normalizedAppName === 'Unknown') {
    return buildUnknownClassification('Unknown')
  }

  const appLower = normalizedAppName.toLowerCase()
  const titleLower = String(windowTitle || '').toLowerCase()
  const urlLower = String(browserUrl || '').toLowerCase()

  if (appLower.includes('velance') || appLower === 'electron') {
    return {
      category: 'System',
      subcategory: 'Velance',
      color: CATEGORY_COLORS.System,
      productive: null,
      app: normalizedAppName,
      confidence: 1,
      contextLabel: 'Velance',
      isCustom: false,
    }
  }

  const isBrowser = BROWSER_APPS.some((browser) => appLower.includes(browser.toLowerCase()))
  if (isBrowser) {
    return classifyBrowserContext(normalizedAppName, windowTitle, browserUrl, customRules)
  }

  const contextLabel = getBrowserContextLabel(windowTitle, browserUrl, normalizedAppName)
  const customRuleMatch = findMatchingCustomRule(customRules, [
    normalizedAppName,
    appLower,
    windowTitle,
    titleLower,
    browserUrl,
    urlLower,
    contextLabel,
  ])
  const customClassification = buildCustomRuleClassification({
    app: normalizedAppName,
    browserUrl,
    contextLabel,
    isCustom: true,
  }, customRuleMatch, 1)
  if (customClassification) return customClassification

  for (const rule of APP_RULES) {
    if (rule.match.some((keyword) => appLower === keyword.toLowerCase())) {
      return { ...rule, app: normalizedAppName, confidence: 1, contextLabel: normalizedAppName, isCustom: false }
    }
    if (rule.match.some((keyword) => appLower.includes(keyword.toLowerCase()) || keyword.toLowerCase().includes(appLower))) {
      return { ...rule, app: normalizedAppName, confidence: 0.75, contextLabel: normalizedAppName, isCustom: false }
    }
  }

  const fallbackClassification = classifyWorkContextFallback(normalizedAppName, windowTitle, browserUrl)
  if (fallbackClassification) return fallbackClassification

  // Window-title signals for completely unknown apps (file extensions, work keywords)
  const titleSignal = classifyByWindowTitleSignals(windowTitle)
  if (titleSignal) {
    return {
      category: titleSignal.category,
      subcategory: titleSignal.subcategory,
      color: CATEGORY_COLORS[titleSignal.category] || CATEGORY_COLORS.Other,
      productive: titleSignal.lane === 'distracting' ? false : true,
      lane: titleSignal.lane,
      app: normalizedAppName,
      confidence: titleSignal.confidence,
      contextLabel: windowTitle || normalizedAppName,
      isCustom: false,
    }
  }

  return {
    category: 'Other',
    subcategory: normalizedAppName,
    color: CATEGORY_COLORS.Other,
    productive: null,
    app: normalizedAppName,
    confidence: 0.3,
    contextLabel: normalizedAppName,
    isCustom: false,
  }
}

export function classifyMediaActivity({
  sourceApp = '',
  trackTitle = '',
  artist = '',
  album = '',
  playbackState = '',
} = {}, customRules = {}) {
  const normalizedApp = normalizeObservedAppName(sourceApp) || 'Media'
  const title = String(trackTitle || '').trim()
  const artistLabel = String(artist || '').trim()
  const albumLabel = String(album || '').trim()
  const stateLabel = String(playbackState || '').trim()
  const searchText = `${normalizedApp} ${title} ${artistLabel} ${albumLabel}`.toLowerCase()
  const browserSource = isBrowserAppName(normalizedApp)
  const browserLearningHits =
    countKeywordMatches(searchText, YOUTUBE_PRODUCTIVE_KEYWORDS) +
    countKeywordMatches(searchText, SUPPORTING_BROWSER_CONTEXT_KEYWORDS)
  const browserDistractingHits =
    countKeywordMatches(searchText, YOUTUBE_DISTRACTING_KEYWORDS) +
    countKeywordMatches(searchText, MEDIA_DISTRACTING_KEYWORDS) +
    countKeywordMatches(searchText, DISTRACTING_BROWSER_CONTEXT_KEYWORDS)

  for (const [key, rule] of Object.entries(customRules || {})) {
    const normalizedKey = String(key || '').toLowerCase()
    if (!normalizedKey) continue
    if (!searchText.includes(normalizedKey)) continue
    const productive = normalizeProvidedProductive(rule.productive)
    const category = rule.category ?? 'Other'
    const subcategory = rule.subcategory ?? ''
    const contextLabel = artistLabel && title ? `${artistLabel} · ${title}` : (title || normalizedApp)
    return {
      category,
      subcategory,
      color: rule.color ?? CATEGORY_COLORS[category] ?? CATEGORY_COLORS.Other,
      productive,
      lane: normalizeLaneKey(rule.lane, {
        productive,
        category,
        subcategory,
        confidence: 1,
        contextLabel,
        appName: normalizedApp,
      }),
      app: normalizedApp,
      confidence: 1,
      contextLabel,
      playbackState: stateLabel || 'Unknown',
      isCustom: true,
    }
  }

  if (browserSource) {
    if (browserLearningHits > browserDistractingHits && browserLearningHits > 0) {
      return {
        category: 'Learning',
        subcategory: 'Browser Learning Media',
        color: CATEGORY_COLORS.Learning,
        productive: true,
        lane: 'supporting',
        app: normalizedApp,
        confidence: 0.9,
        contextLabel: artistLabel && title ? `${artistLabel} · ${title}` : (title || normalizedApp),
        playbackState: stateLabel || 'Unknown',
        isCustom: false,
      }
    }

    if (
      browserDistractingHits > 0 ||
      includesAny(searchText, ['youtube', 'twitch', 'netflix', 'disney+', 'hulu', 'prime video', 'stream', 'live'])
    ) {
      return {
        category: 'Entertainment',
        subcategory: includesAny(searchText, MEDIA_DISTRACTING_KEYWORDS) ? 'Music / Media' : 'Background Video',
        color: CATEGORY_COLORS.Entertainment,
        productive: false,
        lane: 'distracting',
        app: normalizedApp,
        confidence: 0.92,
        contextLabel: artistLabel && title ? `${artistLabel} · ${title}` : (title || normalizedApp),
        playbackState: stateLabel || 'Unknown',
        isCustom: false,
      }
    }
  }

  if (
    includesAny(searchText, ['spotify', 'apple music', 'youtube music', 'deezer', 'tidal', 'music', 'podcast']) &&
    !includesAny(searchText, ['netflix', 'prime video', 'hulu', 'disney+', 'twitch'])
  ) {
    return {
      category: 'Music',
      subcategory: includesAny(searchText, ['podcast', 'lecture', 'course']) ? 'Talk Audio' : 'Audio',
      color: CATEGORY_COLORS.Music,
      productive: null,
      lane: includesAny(searchText, ['lecture', 'course', 'tutorial', 'podcast'])
        ? 'supporting'
        : 'supporting',
      app: normalizedApp,
      confidence: 0.9,
      contextLabel: artistLabel && title ? `${artistLabel} · ${title}` : (title || normalizedApp),
      playbackState: stateLabel || 'Unknown',
      isCustom: false,
    }
  }

  if (includesAny(searchText, ['tutorial', 'course', 'lecture', 'explained', 'lesson', 'learn'])) {
    return {
      category: 'Learning',
      subcategory: 'Media Learning',
      color: CATEGORY_COLORS.Learning,
      productive: true,
      lane: 'supporting',
      app: normalizedApp,
      confidence: 0.84,
      contextLabel: artistLabel && title ? `${artistLabel} · ${title}` : (title || normalizedApp),
      playbackState: stateLabel || 'Unknown',
      isCustom: false,
    }
  }

  if (includesAny(searchText, ['youtube', 'netflix', 'disney+', 'hulu', 'prime video', 'twitch', 'video', 'stream'])) {
    return {
      category: 'Entertainment',
      subcategory: 'Background Video',
      color: CATEGORY_COLORS.Entertainment,
      productive: false,
      lane: 'distracting',
      app: normalizedApp,
      confidence: 0.88,
      contextLabel: artistLabel && title ? `${artistLabel} · ${title}` : (title || normalizedApp),
      playbackState: stateLabel || 'Unknown',
      isCustom: false,
    }
  }

  return {
    category: 'Other',
    subcategory: 'Background Media',
    color: CATEGORY_COLORS.Other,
    productive: null,
    lane: 'unclear',
    app: normalizedApp,
    confidence: 0.42,
    contextLabel: artistLabel && title ? `${artistLabel} · ${title}` : (title || normalizedApp),
    playbackState: stateLabel || 'Unknown',
    isCustom: false,
  }
}

export function normalizeAmbientEntryPayload(entry = {}, { customRules = {}, preferProvidedClassification = false } = {}) {
  const ts = Number(entry.ts ?? Date.now())
  const endTs = Math.max(ts, Number(entry.endTs ?? ts))
  const normalizedApp = normalizeObservedAppName(entry.app ?? entry.appName ?? '') || 'Unknown'
  const title = String(entry.title ?? entry.windowTitle ?? '').slice(0, 240)
  const browserUrl = String(entry.browserUrl ?? entry.url ?? '').slice(0, 2048)
  const browserInfo = normalizeBrowserUrl(browserUrl)
  const browserPage = String(entry.browserPage ?? trimBrowserTitle(title) ?? '').slice(0, 240)

  const providedClassification = preferProvidedClassification && hasProvidedClassification(entry)
    ? {
        category: entry.category ?? 'Other',
        subcategory: entry.subcategory ?? '',
        color: entry.color ?? CATEGORY_COLORS.Other,
        productive: normalizeProvidedProductive(entry.productive),
        confidence: clampNumber(Number(entry.confidence ?? 0), 0, 1),
        isCustom: Boolean(entry.isCustom),
        contextLabel: entry.contextLabel || getBrowserContextLabel(title, browserUrl, normalizedApp),
        lane: entry.lane,
      }
    : null

  const classification = providedClassification || classifyActivity(normalizedApp, title, browserUrl, customRules)
  const productive = normalizeProvidedProductive(classification.productive)
  const date = entry.date || formatLocalDateKey(ts)
  const appGroup = normalizeObservedAppName(entry.appGroup ?? normalizedApp) || normalizedApp
  const browserHost = String(entry.browserHost || browserInfo.host || '').slice(0, 255)
  const contextLabel = String(
    entry.contextLabel ||
    classification.contextLabel ||
    browserPage ||
    browserHost ||
    appGroup ||
    'Tracked activity',
  ).slice(0, 240)

  return {
    id: entry.id || `ambient-${date}-${ts}-${appGroup}`.replace(/\s+/g, '-').slice(0, 240),
    date,
    ts,
    endTs,
    app: normalizedApp,
    appGroup,
    title,
    browserUrl,
    browserHost,
    browserPage,
    duration: Math.max(0, Number(entry.duration ?? 0)),
    switches: Math.max(0, Number(entry.switches ?? 0)),
    category: classification.category ?? 'Other',
    subcategory: classification.subcategory ?? '',
    contextLabel,
    color: classification.color ?? CATEGORY_COLORS[classification.category] ?? CATEGORY_COLORS.Other,
    productive,
    lane: normalizeLaneKey(classification.lane ?? entry.lane, {
      productive,
      category: classification.category,
      subcategory: classification.subcategory,
      confidence: classification.confidence ?? entry.confidence ?? 0,
      contextLabel,
      appName: appGroup,
    }),
    confidence: clampNumber(Number(classification.confidence ?? entry.confidence ?? 0), 0, 1),
    isCustom: Boolean(classification.isCustom ?? entry.isCustom),
    classificationVersion: TRACKING_CLASSIFICATION_VERSION,
  }
}

export function normalizeBackgroundMediaPayload(entry = {}, { customRules = {} } = {}) {
  const ts = Number(entry.ts ?? Date.now())
  const endTs = Math.max(ts, Number(entry.endTs ?? ts))
  const sourceApp = normalizeObservedAppName(entry.sourceApp ?? entry.app ?? 'Media') || 'Media'
  const trackTitle = String(entry.trackTitle ?? entry.title ?? '').slice(0, 240)
  const artist = String(entry.artist ?? '').slice(0, 240)
  const album = String(entry.album ?? '').slice(0, 240)
  const playbackState = String(entry.playbackState ?? entry.state ?? 'Unknown').slice(0, 40)
  const date = entry.date || formatLocalDateKey(ts)
  const classification = classifyMediaActivity({
    sourceApp,
    trackTitle,
    artist,
    album,
    playbackState,
  }, customRules)
  const contextLabel = String(
    entry.contextLabel ||
    classification.contextLabel ||
    (artist && trackTitle ? `${artist} · ${trackTitle}` : trackTitle || sourceApp),
  ).slice(0, 240)
  const productive = normalizeProvidedProductive(classification.productive)

  return {
    id: entry.id || `media-${date}-${ts}-${sourceApp}-${trackTitle}`.replace(/\s+/g, '-').slice(0, 240),
    date,
    ts,
    endTs,
    sourceApp,
    trackTitle,
    artist,
    album,
    playbackState,
    duration: Math.max(0, Number(entry.duration ?? entry.durationSeconds ?? 0)),
    category: classification.category ?? 'Other',
    lane: normalizeLaneKey(classification.lane, {
      productive,
      category: classification.category,
      subcategory: classification.subcategory,
      confidence: classification.confidence ?? entry.confidence ?? 0,
      contextLabel,
      appName: sourceApp,
    }),
    confidence: clampNumber(Number(classification.confidence ?? entry.confidence ?? 0), 0, 1),
    productive,
    contextLabel,
    color: classification.color ?? CATEGORY_COLORS[classification.category] ?? CATEGORY_COLORS.Other,
    classificationVersion: TRACKING_CLASSIFICATION_VERSION,
  }
}
