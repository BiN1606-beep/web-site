local cjson = require "cjson.safe"
local M = {}

local function respond(status, message)
    ngx.status = status
    ngx.header.content_type = "application/json; charset=utf-8"
    ngx.header["Cache-Control"] = "no-store"
    if status == 405 then
        ngx.header.allow = "POST"
    end
    ngx.say(cjson.encode({ error = message }))
    return ngx.exit(status)
end

function M.handle_request()
    if ngx.req.get_method() ~= "POST" then
        return respond(405, "Only POST is supported.")
    end

    if os.getenv("GROQ_FREE_QUOTA_CONFIRMED") ~= "1" then
        return respond(503, "The AI demo is disabled until a zero-cost quota is confirmed.")
    end

    local daily_limit_text = os.getenv("GROQ_FREE_DAILY_REQUEST_LIMIT")
    if not daily_limit_text or not string.match(daily_limit_text, "^[1-9]%d*$") then
        ngx.log(ngx.ERR, "Groq daily request limit is not configured correctly")
        return respond(503, "The AI demo is not configured.")
    end
    local daily_limit = tonumber(daily_limit_text)
    if not daily_limit or daily_limit > 2147483647 then
        ngx.log(ngx.ERR, "Groq daily request limit is outside the supported range")
        return respond(503, "The AI demo is not configured.")
    end

    local api_key = os.getenv("GROQ_API_KEY")
    if not api_key or api_key == "" then
        ngx.log(ngx.ERR, "Groq API key is not configured")
        return respond(503, "The AI demo is not configured.")
    end

    ngx.req.read_body()
    local raw_body = ngx.req.get_body_data()
    if not raw_body then
        return respond(400, "Request body is missing or too large.")
    end

    local body = cjson.decode(raw_body)
    if type(body) ~= "table" or type(body.message) ~= "string" then
        return respond(400, "Request must contain a message string.")
    end

    local message = body.message
    if #message == 0 or #message > 18000 then
        return respond(400, "Message must be between 1 and 18000 bytes.")
    end
    local max_tokens = 500
    if body.maxTokens ~= nil then
        if type(body.maxTokens) ~= "number" or body.maxTokens < 100 or body.maxTokens > 1600
            or body.maxTokens % 1 ~= 0 then
            return respond(400, "maxTokens must be a whole number between 100 and 1600.")
        end
        max_tokens = body.maxTokens
    end
    if body.jsonMode ~= nil and type(body.jsonMode) ~= "boolean" then
        return respond(400, "jsonMode must be true or false.")
    end

    local host = os.getenv("PGHOST")
    local database = os.getenv("PGDATABASE")
    local user = os.getenv("PGUSER")
    local password = os.getenv("PGPASSWORD")
    local port = os.getenv("PGPORT") or "5432"
    if not host or not database or not user or not password then
        ngx.log(ngx.ERR, "PostgreSQL connection environment is incomplete")
        return respond(503, "The AI demo is not configured.")
    end

    local pgmoon = require "pgmoon"
    local pg = pgmoon.new({
        host = host,
        port = port,
        database = database,
        user = user,
        password = password,
    })

    local connect_call_ok, connected, connect_err = pcall(function()
        return pg:connect()
    end)
    if not connect_call_ok then
        ngx.log(ngx.ERR, "Groq quota database connection raised an error: ", connected)
        return respond(503, "The AI demo is temporarily unavailable.")
    end
    if not connected then
        ngx.log(ngx.ERR, "Groq quota database connection failed: ", connect_err or "unknown error")
        return respond(503, "The AI demo is temporarily unavailable.")
    end

    local query_call_ok, usage_result, usage_err = pcall(function()
        return pg:query([[
            INSERT INTO public.groq_daily_usage AS quota (usage_date, request_count)
            VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, 1)
            ON CONFLICT (usage_date) DO UPDATE
            SET request_count = quota.request_count + 1
            WHERE quota.request_count < $1
            RETURNING request_count
        ]], daily_limit)
    end)
    pg:disconnect()

    if not query_call_ok then
        ngx.log(ngx.ERR, "Groq quota query raised an error: ", usage_result)
        return respond(503, "The AI demo is temporarily unavailable.")
    end
    if not usage_result then
        ngx.log(ngx.ERR, "Groq quota query failed: ", usage_err or "unknown error")
        return respond(503, "The AI demo is temporarily unavailable.")
    end
    if not usage_result[1] then
        return respond(429, "The free daily request limit has been reached.")
    end

    local request_body = cjson.encode({
        model = "openai/gpt-oss-120b",
        messages = {
            { role = "user", content = message }
        },
        max_tokens = max_tokens,
        response_format = body.jsonMode and { type = "json_object" } or nil,
    })
    if not request_body then
        ngx.log(ngx.ERR, "Could not encode Groq request body")
        return respond(500, "The AI demo could not prepare the request.")
    end

    local capture_ok, response = pcall(function()
        return ngx.location.capture("/_internal/groq-proxy", {
            method = ngx.HTTP_POST,
            body = request_body,
            headers = {
                Authorization = "Bearer " .. api_key,
                ["Content-Type"] = "application/json",
            },
        })
    end)
    if not capture_ok or not response then
        ngx.log(ngx.ERR, "Groq upstream subrequest failed: ", response or "no response")
        return respond(ngx.HTTP_BAD_GATEWAY, "The AI demo is temporarily unavailable.")
    end
    if response.truncated then
        ngx.log(ngx.ERR, "Groq upstream response was truncated")
        return respond(ngx.HTTP_BAD_GATEWAY, "The AI demo returned an incomplete response.")
    end

    ngx.status = response.status
    ngx.header.content_type = response.header["Content-Type"] or "application/json; charset=utf-8"
    ngx.header["Cache-Control"] = "no-store"
    ngx.print(response.body or "")
    return ngx.exit(response.status)
end

return M
