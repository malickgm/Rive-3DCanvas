-- Drives the live chat list from the ChatRoom ViewModel.
-- Seeds the demo feed, and appends whatever is typed into `draft` when `send` fires.

type ChatNode = {
    vm: ViewModel?,
    messages: PropertyList?,
    draft: Property<string>?,
    seeded: boolean,
    elapsed: number,
    cursor: number,
}

type Seed = { user: string, text: string, color: number }

local SEED: { Seed } = {
    { user = "ShadowX", text = "yoooo", color = 0xFFB44BF5 },
    { user = "Kiraaaa", text = "first time here", color = 0xFF4ADE80 },
    { user = "NightOwl", text = "clean gameplay!", color = 0xFF60A5FA },
    { user = "PixelFox", text = "W stream", color = 0xFF34D399 },
    { user = "FrostByte", text = "nice avatar bro", color = 0xFF38BDF8 },
    { user = "LunaCat", text = "hiiii chat", color = 0xFFF87171 },
    { user = "VoidWalker", text = "clutch", color = 0xFF86EFAC },
    { user = "Takumi_07", text = "lets goooo!!", color = 0xFFF472B6 },
    { user = "Cloudy", text = "W", color = 0xFF93C5FD },
    { user = "EchoX", text = "that timing was insane", color = 0xFF60A5FA },
    { user = "NovaFan", text = "peak content", color = 0xFF4ADE80 },
    { user = "AquaDream", text = "love this game", color = 0xFFEF4444 },
    { user = "Zenix", text = "no way", color = 0xFFF472B6 },
    { user = "Ghost.exe", text = "bro almost died", color = 0xFFA78BFA },
    { user = "Hikari", text = "nice setup", color = 0xFF60A5FA },
}

local SELF_COLOR = 0xFFFFD966

-- How many rows fit the panel. Older rows are dropped off the top so the feed
-- appears to scroll upwards.
local MAX_ROWS = 15

-- Seconds between auto-generated messages.
local NEW_MESSAGE_EVERY = 1.6

-- How many rows the feed starts with, leaving room to visibly stream.
local INITIAL_ROWS = 8

local function addMessage(self: ChatNode, user: string, text: string, color: number)
    local list = self.messages
    if list == nil then
        return
    end
    local item = Data.ChatMessage.new()
    item.username.value = user
    item.message.value = text
    item.color.value = color
    list:push(item)

    -- Drop from the top once the panel is full: the feed runs upwards.
    while list.length > MAX_ROWS do
        list:shift()
    end
end

local function seedMessages(self: ChatNode)
    local list = self.messages
    if list == nil then
        return
    end
    -- Clear first so re-initialising never doubles the feed.
    list:clear()
    for index = 1, INITIAL_ROWS do
        local entry = SEED[index]
        addMessage(self, entry.user, entry.text, entry.color)
    end
    self.cursor = INITIAL_ROWS
end

local function submitDraft(self: ChatNode)
    local draft = self.draft
    if draft == nil then
        return
    end
    local trimmed = string.match(draft.value, "^%s*(.-)%s*$")
    if trimmed == nil or trimmed == "" then
        return
    end
    addMessage(self, "You", trimmed, SELF_COLOR)
    draft.value = ""
end

function init(self: ChatNode, context: Context): boolean
    -- Held on self so the listener below is not garbage collected.
    local vm = context:viewModel()
    self.vm = vm

    if vm then
        self.messages = vm:getList("messages")
        self.draft = vm:getString("draft")

        local send = vm:getTrigger("send")
        if send then
            send:addListener(function()
                submitDraft(self)
            end)
        end
    end

    if not self.seeded then
        self.seeded = true
        seedMessages(self)
    end

    return true
end

function advance(self: ChatNode, seconds: number): boolean
    self.elapsed += seconds
    if self.elapsed >= NEW_MESSAGE_EVERY then
        self.elapsed -= NEW_MESSAGE_EVERY
        -- Cycle through the pool so the feed keeps moving.
        self.cursor = (self.cursor % #SEED) + 1
        local entry = SEED[self.cursor]
        addMessage(self, entry.user, entry.text, entry.color)
    end
    return true
end

return function(): Node<ChatNode>
    return {
        seeded = false,
        elapsed = 0,
        cursor = 0,
        init = init,
        advance = advance,
    }
end
