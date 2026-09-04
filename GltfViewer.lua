-- glTF (.glb) model viewer on a Rive GPU canvas.
--
-- Reads a .glb blob, parses its JSON + BIN chunks, merges every triangle
-- primitive it finds, auto-fits the result to the view, and renders it with
-- the CubeShader. Falls back to a red cube when no model is available.
--
-- To swap models: point the Model ViewModel's `file` blob property at a
-- different .glb asset. The script reloads on change.
--
-- Supports: .glb (binary glTF), POSITION + NORMAL, indexed or non-indexed
-- triangles, byte-strided accessors, u8/u16/u32 indices. Normals are
-- generated when absent.
-- Not supported: .gltf + external .bin, draco compression, skins,
-- animations, materials and textures.

type ModelViewer = {
    -- Inspector inputs. These appear in the property panel and can be keyframed.
    -- Position is in fitted model units; rotation is in degrees.
    positionX: Input<number>,
    positionY: Input<number>,
    positionZ: Input<number>,
    rotationX: Input<number>,
    rotationY: Input<number>,
    rotationZ: Input<number>,
    scaleX: Input<number>,
    scaleY: Input<number>,
    scaleZ: Input<number>,
    autoSpin: Input<number>,
    orbitDistance: Input<number>,

    -- Orbit camera state, driven by pointer drags rather than the inspector.
    orbitYaw: number,
    orbitPitch: number,
    dragging: boolean,
    lastPointerX: number,
    lastPointerY: number,

    vm: ViewModel?,
    blobProp: Property<Blob>?,
    canvas: GPUCanvas?,
    pipeline: GPUPipeline?,
    bindGroup: GPUBindGroup?,
    vertices: GPUBuffer?,
    indices: GPUBuffer?,
    uniforms: GPUBuffer?,
    depthTexture: GPUTexture?,
    depthView: GPUTextureView?,
    sampler: ImageSampler?,
    scratch: buffer?,
    indexCount: number,
    angle: number,
    ready: boolean,
}

local SIZE = 500

-- 3 floats position + 3 floats normal.
local VERTEX_STRIDE = 24
-- mat4 + mat4 + vec4
local UNIFORM_SIZE = 144

local BASE_COLOR = { 0.86, 0.13, 0.16, 1.0 }
local CLEAR_COLOR = { 0.05, 0.05, 0.07, 1.0 }

-- Every model is normalised to this radius so any file frames sensibly.
local FIT_RADIUS = 1.35

-- Radians of orbit per pixel dragged.
local ORBIT_SENSITIVITY = 0.01
-- Stops the camera tipping over the poles.
local MAX_PITCH = math.rad(85)

-- ---------------------------------------------------------------------------
-- Minimal JSON decoder. Luau ships no JSON library and the glTF header chunk
-- is JSON, so we need one.
-- ---------------------------------------------------------------------------

local function jsonDecode(text: string): any
    local pos = 1
    local len = #text

    local function skipSpace()
        while pos <= len do
            local c = string.byte(text, pos)
            if c == 32 or c == 9 or c == 10 or c == 13 then
                pos += 1
            else
                break
            end
        end
    end

    local parseValue: () -> any

    local function parseString(): string
        pos += 1
        local parts: { string } = {}
        while pos <= len do
            local c = string.sub(text, pos, pos)
            if c == '"' then
                pos += 1
                break
            elseif c == "\\" then
                local esc = string.sub(text, pos + 1, pos + 1)
                if esc == "n" then
                    parts[#parts + 1] = "\n"
                elseif esc == "t" then
                    parts[#parts + 1] = "\t"
                elseif esc == "r" then
                    parts[#parts + 1] = "\r"
                elseif esc == "u" then
                    local code = tonumber(string.sub(text, pos + 2, pos + 5), 16)
                    parts[#parts + 1] = utf8.char(code or 63)
                    pos += 4
                else
                    parts[#parts + 1] = esc
                end
                pos += 2
            else
                parts[#parts + 1] = c
                pos += 1
            end
        end
        return table.concat(parts)
    end

    local function parseNumber(): number
        local start = pos
        while pos <= len do
            local c = string.sub(text, pos, pos)
            if string.match(c, "[%d%.%-%+eE]") then
                pos += 1
            else
                break
            end
        end
        return tonumber(string.sub(text, start, pos - 1)) or 0
    end

    function parseValue(): any
        skipSpace()
        local c = string.sub(text, pos, pos)

        if c == "{" then
            pos += 1
            local obj: { [string]: any } = {}
            skipSpace()
            if string.sub(text, pos, pos) == "}" then
                pos += 1
                return obj
            end
            while pos <= len do
                skipSpace()
                local key = parseString()
                skipSpace()
                pos += 1 -- ':'
                obj[key] = parseValue()
                skipSpace()
                local sep = string.sub(text, pos, pos)
                pos += 1
                if sep ~= "," then
                    break
                end
            end
            return obj
        elseif c == "[" then
            pos += 1
            local arr: { any } = {}
            skipSpace()
            if string.sub(text, pos, pos) == "]" then
                pos += 1
                return arr
            end
            while pos <= len do
                arr[#arr + 1] = parseValue()
                skipSpace()
                local sep = string.sub(text, pos, pos)
                pos += 1
                if sep ~= "," then
                    break
                end
            end
            return arr
        elseif c == '"' then
            return parseString()
        elseif c == "t" then
            pos += 4
            return true
        elseif c == "f" then
            pos += 5
            return false
        elseif c == "n" then
            pos += 4
            return nil
        end

        return parseNumber()
    end

    return parseValue()
end

-- ---------------------------------------------------------------------------
-- GLB container
-- ---------------------------------------------------------------------------

local GLB_MAGIC = 0x46546C67 -- "glTF"
local CHUNK_JSON = 0x4E4F534A
local CHUNK_BIN = 0x004E4942

local function parseGlb(data: buffer): (any, buffer?)
    local size = buffer.len(data)
    if size < 12 or buffer.readu32(data, 0) ~= GLB_MAGIC then
        return nil, nil
    end

    local declared = buffer.readu32(data, 8)
    local limit = math.min(declared, size)
    local offset = 12
    local json: any = nil
    local bin: buffer? = nil

    while offset + 8 <= limit do
        local chunkLength = buffer.readu32(data, offset)
        local chunkType = buffer.readu32(data, offset + 4)
        local start = offset + 8
        if start + chunkLength > size then
            break
        end

        if chunkType == CHUNK_JSON then
            json = jsonDecode(buffer.readstring(data, start, chunkLength))
        elseif chunkType == CHUNK_BIN then
            bin = buffer.create(chunkLength)
            buffer.copy(bin :: buffer, 0, data, start, chunkLength)
        end

        offset = start + chunkLength
    end

    return json, bin
end

-- ---------------------------------------------------------------------------
-- Accessors
-- ---------------------------------------------------------------------------

local COMPONENT_BYTES: { [number]: number } = {
    [5120] = 1, -- byte
    [5121] = 1, -- unsigned byte
    [5122] = 2, -- short
    [5123] = 2, -- unsigned short
    [5125] = 4, -- unsigned int
    [5126] = 4, -- float
}

local TYPE_COMPONENTS: { [string]: number } = {
    SCALAR = 1,
    VEC2 = 2,
    VEC3 = 3,
    VEC4 = 4,
}

local function readComponent(bin: buffer, componentType: number, at: number): number
    if componentType == 5126 then
        return buffer.readf32(bin, at)
    elseif componentType == 5125 then
        return buffer.readu32(bin, at)
    elseif componentType == 5123 then
        return buffer.readu16(bin, at)
    elseif componentType == 5121 then
        return buffer.readu8(bin, at)
    elseif componentType == 5122 then
        return buffer.readi16(bin, at)
    end
    return buffer.readi8(bin, at)
end

-- Flattens an accessor into a plain number array, honouring bufferView stride.
local function readAccessor(gltf: any, bin: buffer, index: number): { number }?
    local accessors = gltf.accessors
    if accessors == nil then
        return nil
    end
    local acc = accessors[index + 1]
    if acc == nil or acc.bufferView == nil then
        return nil
    end

    local view = gltf.bufferViews[acc.bufferView + 1]
    if view == nil then
        return nil
    end

    local components = TYPE_COMPONENTS[acc.type] or 1
    local componentBytes = COMPONENT_BYTES[acc.componentType] or 4
    local packed = components * componentBytes
    local stride = view.byteStride or packed
    local base = (view.byteOffset or 0) + (acc.byteOffset or 0)
    local limit = buffer.len(bin)

    local out: { number } = {}
    for i = 0, acc.count - 1 do
        local elementAt = base + i * stride
        if elementAt + packed > limit then
            break
        end
        for c = 0, components - 1 do
            out[#out + 1] = readComponent(bin, acc.componentType, elementAt + c * componentBytes)
        end
    end

    return out
end

-- ---------------------------------------------------------------------------
-- Geometry assembly
-- ---------------------------------------------------------------------------

type Geometry = { positions: { number }, normals: { number }, indices: { number } }

local function newGeometry(): Geometry
    return { positions = {}, normals = {}, indices = {} }
end

-- Area-weighted vertex normals, used when a primitive has no NORMAL attribute.
local function generateNormals(geo: Geometry)
    local positions = geo.positions
    local normals = geo.normals
    local vertexCount = #positions // 3

    for i = 1, vertexCount * 3 do
        normals[i] = 0
    end

    local indices = geo.indices
    for i = 1, #indices - 2, 3 do
        local a, b, c = indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3

        local ax, ay, az = positions[a + 1], positions[a + 2], positions[a + 3]
        local bx, by, bz = positions[b + 1], positions[b + 2], positions[b + 3]
        local cx, cy, cz = positions[c + 1], positions[c + 2], positions[c + 3]

        local ux, uy, uz = bx - ax, by - ay, bz - az
        local vx, vy, vz = cx - ax, cy - ay, cz - az

        local nx = uy * vz - uz * vy
        local ny = uz * vx - ux * vz
        local nz = ux * vy - uy * vx

        for _, base in ipairs({ a, b, c }) do
            normals[base + 1] += nx
            normals[base + 2] += ny
            normals[base + 3] += nz
        end
    end

    for i = 0, vertexCount - 1 do
        local x, y, z = normals[i * 3 + 1], normals[i * 3 + 2], normals[i * 3 + 3]
        local length = math.sqrt(x * x + y * y + z * z)
        if length > 1e-8 then
            normals[i * 3 + 1] = x / length
            normals[i * 3 + 2] = y / length
            normals[i * 3 + 3] = z / length
        else
            normals[i * 3 + 1] = 0
            normals[i * 3 + 2] = 1
            normals[i * 3 + 3] = 0
        end
    end
end

-- Merges every triangle primitive of every mesh into one geometry.
local function geometryFromGltf(gltf: any, bin: buffer): Geometry?
    if gltf == nil or gltf.meshes == nil then
        return nil
    end

    local merged = newGeometry()

    for _, mesh in ipairs(gltf.meshes :: { any }) do
        if mesh.primitives ~= nil then
            for _, prim in ipairs(mesh.primitives :: { any }) do
                -- mode 4 is TRIANGLES; absent means 4 per the spec.
                local mode = prim.mode or 4
                local attributes = prim.attributes
                if mode == 4 and attributes ~= nil and attributes.POSITION ~= nil then
                    local positions = readAccessor(gltf, bin, attributes.POSITION)
                    if positions ~= nil and #positions >= 9 then
                        local vertexCount = #positions // 3
                        local baseVertex = #merged.positions // 3

                        for _, value in ipairs(positions) do
                            merged.positions[#merged.positions + 1] = value
                        end

                        local normals: { number }? = nil
                        if attributes.NORMAL ~= nil then
                            normals = readAccessor(gltf, bin, attributes.NORMAL)
                        end
                        if normals ~= nil and #normals == #positions then
                            for _, value in ipairs(normals :: { number }) do
                                merged.normals[#merged.normals + 1] = value
                            end
                        else
                            -- Placeholder, overwritten by generateNormals below.
                            for _ = 1, vertexCount * 3 do
                                merged.normals[#merged.normals + 1] = 0
                            end
                        end

                        if prim.indices ~= nil then
                            local indices = readAccessor(gltf, bin, prim.indices)
                            if indices ~= nil then
                                for _, value in ipairs(indices) do
                                    merged.indices[#merged.indices + 1] = baseVertex + value
                                end
                            end
                        else
                            for i = 0, vertexCount - 1 do
                                merged.indices[#merged.indices + 1] = baseVertex + i
                            end
                        end
                    end
                end
            end
        end
    end

    if #merged.positions < 9 or #merged.indices < 3 then
        return nil
    end

    -- Cheap check: if any normal is non-zero we assume the file supplied them.
    local hasNormals = false
    for _, value in ipairs(merged.normals) do
        if value ~= 0 then
            hasNormals = true
            break
        end
    end
    if not hasNormals then
        generateNormals(merged)
    end

    return merged
end

-- Centres on the bounding-box middle and scales to FIT_RADIUS.
local function normaliseGeometry(geo: Geometry)
    local positions = geo.positions
    local minX, minY, minZ = math.huge, math.huge, math.huge
    local maxX, maxY, maxZ = -math.huge, -math.huge, -math.huge

    for i = 1, #positions, 3 do
        local x, y, z = positions[i], positions[i + 1], positions[i + 2]
        minX = math.min(minX, x)
        minY = math.min(minY, y)
        minZ = math.min(minZ, z)
        maxX = math.max(maxX, x)
        maxY = math.max(maxY, y)
        maxZ = math.max(maxZ, z)
    end

    local cx = (minX + maxX) * 0.5
    local cy = (minY + maxY) * 0.5
    local cz = (minZ + maxZ) * 0.5

    local extent = math.max(maxX - minX, maxY - minY, maxZ - minZ)
    if extent < 1e-8 then
        extent = 1
    end
    local scale = (FIT_RADIUS * 2) / extent

    for i = 1, #positions, 3 do
        positions[i] = (positions[i] - cx) * scale
        positions[i + 1] = (positions[i + 1] - cy) * scale
        positions[i + 2] = (positions[i + 2] - cz) * scale
    end
end

local function geometryToBuffers(geo: Geometry): (buffer, buffer, number)
    local vertexCount = #geo.positions // 3
    local vertexData = buffer.create(vertexCount * VERTEX_STRIDE)

    for i = 0, vertexCount - 1 do
        local at = i * VERTEX_STRIDE
        local p = i * 3
        buffer.writef32(vertexData, at, geo.positions[p + 1])
        buffer.writef32(vertexData, at + 4, geo.positions[p + 2])
        buffer.writef32(vertexData, at + 8, geo.positions[p + 3])
        buffer.writef32(vertexData, at + 12, geo.normals[p + 1] or 0)
        buffer.writef32(vertexData, at + 16, geo.normals[p + 2] or 1)
        buffer.writef32(vertexData, at + 20, geo.normals[p + 3] or 0)
    end

    local indexCount = #geo.indices
    local indexData = buffer.create(indexCount * 4)
    for i = 1, indexCount do
        buffer.writeu32(indexData, (i - 1) * 4, geo.indices[i])
    end

    return vertexData, indexData, indexCount
end

-- ---------------------------------------------------------------------------
-- Fallback cube, shown until a model is supplied.
-- ---------------------------------------------------------------------------

local CUBE_FACES = {
    { n = { 1, 0, 0 }, v = { { 1, -1, 1 }, { 1, -1, -1 }, { 1, 1, -1 }, { 1, 1, 1 } } },
    { n = { -1, 0, 0 }, v = { { -1, -1, -1 }, { -1, -1, 1 }, { -1, 1, 1 }, { -1, 1, -1 } } },
    { n = { 0, 1, 0 }, v = { { -1, 1, 1 }, { 1, 1, 1 }, { 1, 1, -1 }, { -1, 1, -1 } } },
    { n = { 0, -1, 0 }, v = { { -1, -1, -1 }, { 1, -1, -1 }, { 1, -1, 1 }, { -1, -1, 1 } } },
    { n = { 0, 0, 1 }, v = { { -1, -1, 1 }, { 1, -1, 1 }, { 1, 1, 1 }, { -1, 1, 1 } } },
    { n = { 0, 0, -1 }, v = { { 1, -1, -1 }, { -1, -1, -1 }, { -1, 1, -1 }, { 1, 1, -1 } } },
}

local function cubeGeometry(): Geometry
    local geo = newGeometry()
    local base = 0
    for _, face in ipairs(CUBE_FACES) do
        for _, corner in ipairs(face.v) do
            geo.positions[#geo.positions + 1] = corner[1]
            geo.positions[#geo.positions + 1] = corner[2]
            geo.positions[#geo.positions + 1] = corner[3]
            geo.normals[#geo.normals + 1] = face.n[1]
            geo.normals[#geo.normals + 1] = face.n[2]
            geo.normals[#geo.normals + 1] = face.n[3]
        end
        for _, step in ipairs({ 0, 1, 2, 0, 2, 3 }) do
            geo.indices[#geo.indices + 1] = base + step
        end
        base += 4
    end
    return geo
end

-- ---------------------------------------------------------------------------
-- Upload + load
-- ---------------------------------------------------------------------------

local function uploadGeometry(self: ModelViewer, geo: Geometry)
    normaliseGeometry(geo)
    local vertexData, indexData, indexCount = geometryToBuffers(geo)

    self.vertices = GPUBuffer.new({
        size = buffer.len(vertexData),
        usage = "vertex",
        data = vertexData,
        immutable = true,
        label = "model-vertices",
    })
    self.indices = GPUBuffer.new({
        size = buffer.len(indexData),
        usage = "index",
        data = indexData,
        immutable = true,
        label = "model-indices",
    })
    self.indexCount = indexCount
end

local function loadFromBlob(self: ModelViewer, blob: Blob?): boolean
    if blob == nil or blob.data == nil then
        return false
    end

    local gltf, bin = parseGlb(blob.data)
    if gltf == nil then
        print("[GltfViewer] not a .glb file: " .. tostring(blob.name))
        return false
    end
    if bin == nil then
        print("[GltfViewer] .glb has no BIN chunk (external buffers are unsupported)")
        return false
    end

    local geo = geometryFromGltf(gltf, bin :: buffer)
    if geo == nil then
        print("[GltfViewer] no triangle geometry found in " .. tostring(blob.name))
        return false
    end

    uploadGeometry(self, geo)
    print("[GltfViewer] loaded " .. tostring(blob.name) .. ": " .. tostring(self.indexCount // 3) .. " triangles")
    return true
end

local function reload(self: ModelViewer)
    local prop = self.blobProp
    if prop ~= nil and loadFromBlob(self, prop.value) then
        return
    end
    uploadGeometry(self, cubeGeometry())
end

-- ---------------------------------------------------------------------------
-- Node protocol
-- ---------------------------------------------------------------------------

function init(self: ModelViewer, context: Context): boolean
    local shader = context:shader("CubeShader")
    if shader == nil then
        print("[GltfViewer] shader 'CubeShader' not found")
        return true
    end

    local canvas = context:gpuCanvas({ width = SIZE, height = SIZE })
    self.canvas = canvas

    local uniforms = GPUBuffer.new({
        size = UNIFORM_SIZE,
        usage = "uniform",
        label = "model-uniforms",
    })
    self.uniforms = uniforms

    -- Held on self so the texture outlives the view.
    local depthTexture = GPUTexture.new({
        width = SIZE,
        height = SIZE,
        format = "depth24plus-stencil8",
        renderTarget = true,
        label = "model-depth",
    })
    self.depthTexture = depthTexture
    self.depthView = depthTexture:view()

    local pipeline = GPUPipeline.new({
        vertex = { module = shader, entryPoint = "vs_main" },
        fragment = { module = shader, entryPoint = "fs_main" },
        vertexLayout = {
            {
                stride = VERTEX_STRIDE,
                attributes = {
                    { format = "float32x3", slot = 0, offset = 0 },
                    { format = "float32x3", slot = 1, offset = 12 },
                },
            },
        },
        colorTargets = { { format = canvas.format } },
        depthStencil = { format = "depth24plus-stencil8", compare = "less", write = true },
        cullMode = "back",
        topology = "triangle-list",
    })

    self.pipeline = pipeline
    self.bindGroup = GPUBindGroup.new({
        layout = pipeline:getBindGroupLayout(0),
        ubos = { { slot = 0, buffer = uniforms } },
    })

    -- Held on self so the listener below is not garbage collected.
    local vm = context:viewModel()
    self.vm = vm
    if vm then
        self.blobProp = vm:getBlob("file")

        local prop = self.blobProp
        if prop then
            prop:addListener(function()
                reload(self)
            end)
        end
    end

    -- Reused every frame rather than reallocated.
    self.scratch = buffer.create(UNIFORM_SIZE)
    self.sampler = ImageSampler("clamp", "clamp", "bilinear")

    reload(self)

    self.ready = true
    return true
end

function advance(self: ModelViewer, seconds: number): boolean
    -- Layered on top of the keyframable rotationY. Set autoSpin to 0 to
    -- drive rotation purely from the timeline.
    self.angle += math.rad(self.autoSpin) * seconds
    return true
end

function drawCanvas(self: ModelViewer)
    if not self.ready then
        return
    end

    local canvas = self.canvas
    local pipeline = self.pipeline
    local bindGroup = self.bindGroup
    local uniforms = self.uniforms
    local scratch = self.scratch
    local depthView = self.depthView
    if canvas == nil or pipeline == nil or bindGroup == nil or uniforms == nil then
        return
    end
    if scratch == nil or depthView == nil or canvas.width == 0 then
        return
    end
    local vertexBuffer = self.vertices
    local indexBuffer = self.indices
    if vertexBuffer == nil or indexBuffer == nil or self.indexCount == 0 then
        return
    end

    local translation = Mat4.fromTranslation(self.positionX, self.positionY, self.positionZ)
    local rotation = Mat4.fromRotationY(math.rad(self.rotationY) + self.angle)
        * Mat4.fromRotationX(math.rad(self.rotationX))
        * Mat4.fromRotationZ(math.rad(self.rotationZ))
    local scale = Mat4.fromScale(self.scaleX, self.scaleY, self.scaleZ)
    local model = translation * rotation * scale

    -- Orbit camera: spherical position around the origin.
    local distance = math.max(self.orbitDistance, 0.2)
    local cosPitch = math.cos(self.orbitPitch)
    local eye = Vector.xyz(
        distance * cosPitch * math.sin(self.orbitYaw),
        distance * math.sin(self.orbitPitch),
        distance * cosPitch * math.cos(self.orbitYaw)
    )
    local view = Mat4.lookAt(eye, Vector.origin(), Vector.xyz(0, 1, 0))
    local proj = Mat4.perspective(math.rad(42), canvas.width / canvas.height, 0.1, 100)
    local mvp = proj * view * model

    mvp:writeToBuffer(scratch, 0)
    model:writeToBuffer(scratch, 64)
    buffer.writef32(scratch, 128, BASE_COLOR[1])
    buffer.writef32(scratch, 132, BASE_COLOR[2])
    buffer.writef32(scratch, 136, BASE_COLOR[3])
    buffer.writef32(scratch, 140, BASE_COLOR[4])
    uniforms:write(scratch)

    local pass = canvas:beginRenderPass({
        color = { {
            loadOp = "clear",
            storeOp = "store",
            clearColor = CLEAR_COLOR,
        } },
        depthStencil = {
            view = depthView,
            depthLoadOp = "clear",
            depthStoreOp = "discard",
            depthClearValue = 1,
        },
    })

    pass:setPipeline(pipeline)
    pass:setVertexBuffer(0, vertexBuffer)
    pass:setIndexBuffer(indexBuffer, "uint32")
    pass:setBindGroup(0, bindGroup)
    pass:drawIndexed(self.indexCount)
    pass:finish()
end

function pointerDown(self: ModelViewer, event: PointerEvent)
    -- Claim the pointer so move/up are delivered here.
    event:hit()
    self.dragging = true
    self.lastPointerX = event.position.x
    self.lastPointerY = event.position.y
end

function pointerMove(self: ModelViewer, event: PointerEvent)
    if not self.dragging then
        return
    end

    local x = event.position.x
    local y = event.position.y
    local dx = x - self.lastPointerX
    local dy = y - self.lastPointerY
    self.lastPointerX = x
    self.lastPointerY = y

    self.orbitYaw -= dx * ORBIT_SENSITIVITY
    self.orbitPitch = math.clamp(
        self.orbitPitch + dy * ORBIT_SENSITIVITY,
        -MAX_PITCH,
        MAX_PITCH
    )
end

function pointerUp(self: ModelViewer, event: PointerEvent)
    self.dragging = false
end

function pointerExit(self: ModelViewer, event: PointerEvent)
    self.dragging = false
end

function draw(self: ModelViewer, renderer: Renderer)
    local canvas = self.canvas
    local sampler = self.sampler
    if canvas == nil or sampler == nil or canvas.image == nil then
        return
    end

    -- Centre the canvas on the node's own origin.
    renderer:save()
    renderer:transform(Mat2D.withTranslation(-canvas.width / 2, -canvas.height / 2))
    renderer:drawImage(canvas.image, sampler, "srcOver", 1)
    renderer:restore()
end

return function(): Node<ModelViewer>
    return {
        positionX = 0,
        positionY = 0,
        positionZ = 0,
        rotationX = 0,
        rotationY = 0,
        rotationZ = 0,
        scaleX = 1,
        scaleY = 1,
        scaleZ = 1,
        autoSpin = 30,
        orbitDistance = 5.2,

        orbitYaw = 0,
        orbitPitch = 0,
        dragging = false,
        lastPointerX = 0,
        lastPointerY = 0,

        indexCount = 0,
        angle = 0,
        ready = false,
        init = init,
        advance = advance,
        drawCanvas = drawCanvas,
        draw = draw,
        pointerDown = pointerDown,
        pointerMove = pointerMove,
        pointerUp = pointerUp,
        pointerExit = pointerExit,
    }
end
