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
    io:format("Client connected~n"),
    {[], State}.

websocket_handle({text, Msg}, State) ->
    io:format("Received: ~s~n", [Msg]),

    Reply = Msg,

    {[{text, Reply}], State};

websocket_handle(_, State) ->
    {[], State}.

websocket_info(_, State) ->
    {[], State}.