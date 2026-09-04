-- Countdown timer driven entirely by the CountdownTimer ViewModel.
-- durationInput is typed as text ("90", "5:00", "1:02:03").

type TimerNode = {
    context: Context?,
    vm: ViewModel?,
    durationInput: Property<string>?,
    display: Property<string>?,
    remainingSeconds: Property<number>?,
    isRunning: Property<boolean>?,
    finished: PropertyTrigger?,
    remaining: number,
    duration: number,
    didFinish: boolean,
}

-- "90" -> 90, "5:00" -> 300, "1:02:03" -> 3723. nil when unparseable.
local function parseDuration(text: string): number?
    local parts: { number } = {}
    for chunk in string.gmatch(text, "[^:]+") do
        local trimmed = string.match(chunk, "^%s*(.-)%s*$")
        local n = tonumber(trimmed)
        if n == nil or n < 0 then
            return nil
        end
        table.insert(parts, n)
    end
    if #parts == 0 or #parts > 3 then
        return nil
    end
    local total = 0
    for _, n in ipairs(parts) do
        total = total * 60 + n
    end
    return total
end

-- Ceil so a fresh 5:00 reads 05:00, and 00:00 appears only at true zero.
local function formatClock(seconds: number): string
    local whole = math.ceil(seconds - 0.0001)
    if whole < 0 then
        whole = 0
    end
    local hours = math.floor(whole / 3600)
    local minutes = math.floor((whole % 3600) / 60)
    local secs = whole % 60
    if hours > 0 then
        return string.format("%d:%02d:%02d", hours, minutes, secs)
    end
    return string.format("%02d:%02d", minutes, secs)
end

local function publish(self: TimerNode, value: number)
    if value < 0 then
        value = 0
    end
    self.remaining = value
    local raw = self.remainingSeconds
    if raw then
        raw.value = value
    end
    local text = self.display
    if text then
        text.value = formatClock(value)
    end
end

local function readDuration(self: TimerNode)
    local input = self.durationInput
    if input then
        local parsed = parseDuration(input.value)
        -- Keep the last valid duration if the text is malformed.
        if parsed then
            self.duration = parsed
        end
    end
end

local function setRunning(self: TimerNode, value: boolean)
    local running = self.isRunning
    if running then
        running.value = value
    end
end

local function doReset(self: TimerNode)
    readDuration(self)
    setRunning(self, false)
    self.didFinish = false
    publish(self, self.duration)
end

local function doStart(self: TimerNode)
    -- Starting from zero re-arms with the current text.
    if self.remaining <= 0 then
        readDuration(self)
        self.didFinish = false
        publish(self, self.duration)
    end
    if self.remaining > 0 then
        setRunning(self, true)
    end
end

local function doPause(self: TimerNode)
    setRunning(self, false)
end

function init(self: TimerNode, context: Context): boolean
    self.context = context

    -- Held on self so the listeners below are not garbage collected.
    local vm = context:viewModel()
    self.vm = vm

    if vm then
        self.durationInput = vm:getString("durationInput")
        self.display = vm:getString("display")
        self.remainingSeconds = vm:getNumber("remainingSeconds")
        self.isRunning = vm:getBoolean("isRunning")
        self.finished = vm:getTrigger("finished")

        local startTrigger = vm:getTrigger("start")
        if startTrigger then
            startTrigger:addListener(function()
                doStart(self)
            end)
        end

        local pauseTrigger = vm:getTrigger("pause")
        if pauseTrigger then
            pauseTrigger:addListener(function()
                doPause(self)
            end)
        end

        local resetTrigger = vm:getTrigger("reset")
        if resetTrigger then
            resetTrigger:addListener(function()
                doReset(self)
            end)
        end

        -- Retyping the duration while stopped refreshes the display immediately.
        local input = self.durationInput
        if input then
            input:addListener(function()
                local running = self.isRunning
                if running == nil or not running.value then
                    doReset(self)
                end
            end)
        end
    end

    doReset(self)
    return true
end

function advance(self: TimerNode, seconds: number): boolean
    local running = self.isRunning
    if running and running.value and self.remaining > 0 then
        local upcoming = self.remaining - seconds
        if upcoming <= 0 then
            publish(self, 0)
            setRunning(self, false)
            if not self.didFinish then
                self.didFinish = true
                local done = self.finished
                if done then
                    done:fire()
                end
            end
        else
            publish(self, upcoming)
        end
    end
    return true
end

return function(): Node<TimerNode>
    return {
        remaining = 0,
        duration = 300,
        didFinish = false,
        init = init,
        advance = advance,
    }
end
