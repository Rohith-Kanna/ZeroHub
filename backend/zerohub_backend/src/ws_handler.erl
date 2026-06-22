-module(ws_handler).

-export([
    init/2,
    websocket_init/1,
    websocket_handle/2,
    websocket_info/2,
    terminate/3
]).

-record(ws_state, {
    room_id = undefined,
    username = undefined,
    color = undefined
}).

init(Req, State) ->
    {cowboy_websocket, Req, State}.

websocket_init(_State) ->
    client_registry:add(self()),
    io:format("Client connected: ~p~n", [self()]),
    {[], #ws_state{}}.

websocket_handle({text, MsgBin}, State) ->
    try
        Map = simple_json:parse(MsgBin),
        handle_client_msg(maps:get(<<"type">>, Map, undefined), Map, State)
    catch
        Error:Reason:Stacktrace ->
            io:format("Error handling ws message: ~p ~p~nStacktrace: ~p~n", [Error, Reason, Stacktrace]),
            {[], State}
    end;

websocket_handle(_, State) ->
    {[], State}.

websocket_info({presence_update, Clients}, State) ->
    UsersJson = [ #{
        <<"clientId">> => list_to_binary(pid_to_list(P)),
        <<"username">> => U,
        <<"color">> => C
    } || {P, U, C} <- Clients ],
    
    Response = simple_json:encode(#{
        <<"type">> => <<"presence_list">>,
        <<"users">> => UsersJson
    }),
    {[{text, Response}], State};

websocket_info({yjs_update_broadcast, SenderPid, Update}, State) ->
    %% Only send if we are not the sender
    case SenderPid == self() of
        true ->
            {[], State};
        false ->
            Response = simple_json:encode(#{
                <<"type">> => <<"yjs_update">>,
                <<"update">> => Update
            }),
            {[{text, Response}], State}
    end;

websocket_info({cursor_broadcast, SenderPid, SenderUsername, SenderColor, Position}, State) ->
    case SenderPid == self() of
        true ->
            {[], State};
        false ->
            Response = simple_json:encode(#{
                <<"type">> => <<"cursor">>,
                <<"clientId">> => list_to_binary(pid_to_list(SenderPid)),
                <<"username">> => SenderUsername,
                <<"color">> => SenderColor,
                <<"position">> => Position
            }),
            {[{text, Response}], State}
    end;

websocket_info(_, State) ->
    {[], State}.

terminate(_Reason, _Req, _State) ->
    io:format("Client disconnected: ~p~n", [self()]),
    room_manager:leave_room(self()),
    client_registry:remove(self()),
    ok.

%% Internal message handlers

handle_client_msg(<<"join">>, Map, State) ->
    RoomId = maps:get(<<"roomId">>, Map, undefined),
    Username = maps:get(<<"username">>, Map, <<"Anonymous">>),
    
    case RoomId of
        undefined ->
            {[], State};
        _ ->
            {ok, Color, _Clients} = room_manager:join_room(RoomId, self(), Username),
            
            %% Fetch past Yjs updates for this room to sync the editor
            Updates = room_manager:get_updates(RoomId),
            
            JoinedMsg = simple_json:encode(#{
                <<"type">> => <<"joined">>,
                <<"roomId">> => RoomId,
                <<"color">> => Color,
                <<"clientId">> => list_to_binary(pid_to_list(self()))
            }),
            
            InitMsg = simple_json:encode(#{
                <<"type">> => <<"yjs_init">>,
                <<"updates">> => Updates
            }),
            
            {[{text, JoinedMsg}, {text, InitMsg}], State#ws_state{
                room_id = RoomId,
                username = Username,
                color = Color
            }}
    end;

handle_client_msg(<<"yjs_update">>, Map, #ws_state{room_id = RoomId} = State) when RoomId /= undefined ->
    Update = maps:get(<<"update">>, Map, undefined),
    case Update of
        undefined ->
            {[], State};
        _ ->
            %% Store the update in room_manager
            room_manager:add_update(RoomId, Update),
            
            %% Broadcast update to other room members
            Clients = room_manager:get_room_clients(RoomId),
            lists:foreach(fun({Pid, _, _}) ->
                Pid ! {yjs_update_broadcast, self(), Update}
            end, Clients),
            
            {[], State}
    end;

handle_client_msg(<<"cursor">>, Map, #ws_state{room_id = RoomId, username = Username, color = Color} = State) when RoomId /= undefined ->
    Position = maps:get(<<"position">>, Map, undefined),
    case Position of
        undefined ->
            {[], State};
        _ ->
            Clients = room_manager:get_room_clients(RoomId),
            lists:foreach(fun({Pid, _, _}) ->
                Pid ! {cursor_broadcast, self(), Username, Color, Position}
            end, Clients),
            
            {[], State}
    end;

handle_client_msg(_, _Map, State) ->
    {[], State}.