-module(ws_handler).

-export([
    init/2,
    websocket_init/1,
    websocket_handle/2,
    websocket_info/2
]).

init(Req, State) ->
    {cowboy_websocket, Req, State}.

websocket_init(State) ->
    {[], State}.

websocket_handle({text, Msg}, State) ->
    {[{text, <<"Echo: ", Msg/binary>>}], State};

websocket_handle(_Data, State) ->
    {[], State}.

websocket_info(_Info, State) ->
    {[], State}.