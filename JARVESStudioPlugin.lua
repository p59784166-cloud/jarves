local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local ServerScriptService = game:GetService("ServerScriptService")
local StarterPlayer = game:GetService("StarterPlayer")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local toolbar = plugin:CreateToolbar("JARVES AI")
local openButton = toolbar:CreateButton("JARVES Studio Bridge", "Connect to JARVES on this computer", "")
openButton.ClickableWhenViewportHidden = true

local widgetInfo = DockWidgetPluginGuiInfo.new(
	Enum.InitialDockState.Float,
	false,
	false,
	390,
	520,
	320,
	360
)
local widget = plugin:CreateDockWidgetPluginGui("JARVESStudioBridge", widgetInfo)
widget.Title = "JARVES Studio Bridge"

local root = Instance.new("Frame")
root.Name = "Root"
root.Size = UDim2.fromScale(1, 1)
root.BackgroundColor3 = Color3.fromRGB(28, 31, 40)
root.BorderSizePixel = 0
root.Parent = widget

local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 8)
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Parent = root

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 12)
padding.PaddingBottom = UDim.new(0, 12)
padding.PaddingLeft = UDim.new(0, 12)
padding.PaddingRight = UDim.new(0, 12)
padding.Parent = root

local function makeLabel(name, text, height)
	local label = Instance.new("TextLabel")
	label.Name = name
	label.Size = UDim2.new(1, 0, 0, height or 24)
	label.BackgroundTransparency = 1
	label.TextColor3 = Color3.fromRGB(235, 238, 245)
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextWrapped = true
	label.Font = Enum.Font.SourceSans
	label.TextSize = 15
	label.Text = text
	label.Parent = root
	return label
end

local function makeInput(name, placeholder, initial, height)
	local input = Instance.new("TextBox")
	input.Name = name
	input.Size = UDim2.new(1, 0, 0, height or 34)
	input.BackgroundColor3 = Color3.fromRGB(43, 47, 59)
	input.BorderSizePixel = 0
	input.ClearTextOnFocus = false
	input.TextColor3 = Color3.fromRGB(245, 246, 250)
	input.PlaceholderColor3 = Color3.fromRGB(165, 170, 182)
	input.PlaceholderText = placeholder
	input.Text = initial or ""
	input.Font = Enum.Font.Code
	input.TextSize = 13
	input.TextXAlignment = Enum.TextXAlignment.Left
	input.Parent = root
	return input
end

local function makeButton(name, text)
	local button = Instance.new("TextButton")
	button.Name = name
	button.Size = UDim2.new(1, 0, 0, 36)
	button.BackgroundColor3 = Color3.fromRGB(92, 109, 232)
	button.BorderSizePixel = 0
	button.TextColor3 = Color3.new(1, 1, 1)
	button.Font = Enum.Font.SourceSansBold
	button.TextSize = 15
	button.Text = text
	button.Parent = root
	return button
end

local address = makeInput("ServerAddress", "JARVES address, e.g. http://127.0.0.1:3210", plugin:GetSetting("serverAddress") or "http://127.0.0.1:3210")
local token = makeInput("BridgeToken", "Paste the JARVES pairing token")
local connectButton = makeButton("Connect", "Connect")
local status = makeLabel("ConnectionStatus", "Not connected", 36)
local scriptInfo = makeLabel("ScriptInfo", "No pending script. Scripts are never inserted automatically.", 48)
local preview = makeInput("ScriptPreview", "Luau preview", "", 190)
preview.MultiLine = true
preview.TextYAlignment = Enum.TextYAlignment.Top
preview.TextEditable = false
local insertButton = makeButton("InsertScript", "Insert into Studio")
local discardButton = makeButton("DiscardScript", "Discard pending script")
insertButton.Visible = false
discardButton.Visible = false

local currentScript = nil
local lastSeenId = nil
local connected = false
local busy = false

local function request(path, method, body)
	local base = string.gsub(string.gsub(address.Text, "%s+$", ""), "/+$", "")
	local headers = { ["X-Jarves-Bridge-Token"] = token.Text }
	if body then
		headers["Content-Type"] = "application/json"
	end
	return HttpService:RequestAsync({
		Url = base .. path,
		Method = method,
		Headers = headers,
		Body = body and HttpService:JSONEncode(body) or nil,
	})
end

local function showScript(scriptData)
	currentScript = scriptData
	if scriptData then
		lastSeenId = scriptData.id
	end
	insertButton.Visible = scriptData ~= nil
	discardButton.Visible = scriptData ~= nil
	if not scriptData then
		scriptInfo.Text = "No pending script. Scripts are never inserted automatically."
		preview.Text = ""
		return
	end
	scriptInfo.Text = string.format("%s (%s) → %s · Review before inserting", scriptData.name, scriptData.className, scriptData.target)
	preview.Text = scriptData.source
end

local function poll()
	if not connected or busy then
		return
	end
	busy = true
	local ok, response = pcall(request, "/api/roblox/next", "GET")
	if ok and response.Success then
		local decodedOk, decoded = pcall(function()
			return HttpService:JSONDecode(response.Body)
		end)
		if decodedOk and decoded.script and decoded.script.id ~= lastSeenId then
			showScript(decoded.script)
			status.Text = "Connected · review the pending script below"
		elseif decodedOk and not decoded.script then
			showScript(nil)
			status.Text = "Connected · waiting for a script from JARVES"
		elseif not decodedOk then
			status.Text = "Could not read the JARVES response"
		end
	elseif ok then
		connected = false
		status.Text = "Connection expired or rejected · reconnect with a new token"
	else
		status.Text = "Local connection failed · check the address and JARVES server"
	end
	busy = false
end

connectButton.Activated:Connect(function()
	if busy then
		return
	end
	busy = true
	status.Text = "Connecting to JARVES..."
	local ok, response = pcall(request, "/api/roblox/status", "GET")
	if ok and response.Success then
		connected = true
		plugin:SetSetting("serverAddress", address.Text)
		status.Text = "Connected · awaiting your approval for every insertion"
		poll()
	elseif ok then
		connected = false
		status.Text = "Connection rejected · verify the token and local address"
	else
		connected = false
		status.Text = "Could not connect · allow local HTTP requests in Studio"
	end
	busy = false
end)

local function acknowledge(action, scriptData)
	scriptData = scriptData or currentScript
	if not scriptData or busy then
		return
	end
	busy = true
	local ok, response = pcall(request, "/api/roblox/ack", "POST", {
		id = scriptData.id,
		action = action,
	})
	if ok and response.Success then
		if currentScript == scriptData then
			showScript(nil)
		end
		status.Text = action == "inserted" and "Script inserted; save your place in Studio." or "Pending script discarded."
	else
		if action == "inserted" and currentScript == scriptData then
			showScript(nil)
			status.Text = "Script inserted, but JARVES did not confirm it; it will not be inserted again in this Studio session."
		else
			status.Text = "Could not confirm with JARVES; reconnect before retrying."
		end
	end
	busy = false
end

insertButton.Activated:Connect(function()
	if not currentScript or not connected or busy then
		return
	end
	local parents = {
		ServerScriptService = { instance = ServerScriptService, className = "Script" },
		StarterPlayerScripts = { instance = StarterPlayer:WaitForChild("StarterPlayerScripts"), className = "LocalScript" },
		ReplicatedStorage = { instance = ReplicatedStorage, className = "ModuleScript" },
	}
	local destination = parents[currentScript.target]
	if not destination or destination.className ~= currentScript.className or type(currentScript.source) ~= "string" then
		status.Text = "Rejected script: destination or type is not allowed."
		return
	end
	busy = true
	local ok, result = pcall(function()
		ChangeHistoryService:SetWaypoint("Before JARVES script insertion")
		local scriptObject = Instance.new(destination.className)
		scriptObject.Name = currentScript.name
		scriptObject.Source = currentScript.source
		scriptObject.Parent = destination.instance
		ChangeHistoryService:SetWaypoint("Insert JARVES script")
		return scriptObject
	end)
	if ok then
		busy = false
		acknowledge("inserted", currentScript)
	else
		status.Text = "Studio could not insert the script: " .. tostring(result)
		busy = false
	end
end)

discardButton.Activated:Connect(function()
	acknowledge("dismissed")
end)

openButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

widget:GetPropertyChangedSignal("Enabled"):Connect(function()
	if widget.Enabled and connected then
		poll()
	end
end)

task.spawn(function()
	while true do
		task.wait(3)
		if widget.Enabled then
			poll()
		end
	end
end)
