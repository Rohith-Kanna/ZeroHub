-module(room_manager).
-behaviour(gen_server).

-export([
    start_link/0,
    join_room/3,
    leave_room/1,
    get_room_clients/1,
    get_client_room/1,
    add_update/2,
    get_updates/1,
    get_active_rooms/0
]).

%% gen_server callbacks
-export([init/1, handle_call/3, handle_cast/2, handle_info/2, terminate/2, code_change/3]).

-define(SERVER, ?MODULE).

-define(COLORS, [
    <<"#39ff14">>, % Neon Green
    <<"#00ffff">>, % Cyan
    <<"#ff007f">>, % Hot Pink
    <<"#ffaa00">>, % Neon Orange
    <<"#9d00ff">>, % Neon Purple
    <<"#ffff00">>, % Neon Yellow
    <<"#00ffaa">>, % Teal
    <<"#ff3333">>  % Neon Red
]).

-record(state, {
    rooms = #{},         % RoomId => [{Pid, Username, Color}]
    client_rooms = #{},  % Pid => RoomId
    updates = #{}        % RoomId => [UpdateBinary]
}).

%% API

start_link() ->
    gen_server:start_link({local, ?SERVER}, ?MODULE, [], []).

join_room(RoomId, Pid, Username) ->
    gen_server:call(?SERVER, {join, RoomId, Pid, Username}).

leave_room(Pid) ->
    gen_server:call(?SERVER, {leave, Pid}).

get_room_clients(RoomId) ->
    gen_server:call(?SERVER, {get_clients, RoomId}).

get_client_room(Pid) ->
    gen_server:call(?SERVER, {get_room, Pid}).

add_update(RoomId, Update) ->
    gen_server:cast(?SERVER, {add_update, RoomId, Update}).

get_updates(RoomId) ->
    gen_server:call(?SERVER, {get_updates, RoomId}).

get_active_rooms() ->
    gen_server:call(?SERVER, get_active_rooms).

%% gen_server callbacks

init([]) ->
    io:format("Room Manager started~n"),
    {ok, #state{}}.

handle_call({join, RoomId, Pid, Username}, _From, State) ->
    %% First leave any existing room
    State1 = do_leave(Pid, State),

    %% Start monitoring the connection process
    erlang:monitor(process, Pid),

    %% Find existing room clients
    Clients = maps:get(RoomId, State1#state.rooms, []),
    
    %% Assign a collaborator color
    ColorIdx = (length(Clients) rem length(?COLORS)) + 1,
    Color = lists:nth(ColorIdx, ?COLORS),

    NewClients = [{Pid, Username, Color} | Clients],
    
    NewRooms = (State1#state.rooms)#{RoomId => NewClients},
    NewClientRooms = (State1#state.client_rooms)#{Pid => RoomId},
    
    %% If room didn't exist in updates map, create empty list
    NewUpdates = case maps:is_key(RoomId, State1#state.updates) of
        true -> State1#state.updates;
        false -> (State1#state.updates)#{RoomId => []}
    end,

    NewState = State1#state{
        rooms = NewRooms,
        client_rooms = NewClientRooms,
        updates = NewUpdates
    },
    
    %% Notify all clients in the room about the updated presence
    notify_presence(NewClients),
    
    {reply, {ok, Color, NewClients}, NewState};

handle_call({leave, Pid}, _From, State) ->
    {Reply, NewState} = case maps:get(Pid, State#state.client_rooms, undefined) of
        undefined ->
            {ok, State};
        RoomId ->
            S = do_leave(Pid, State),
            Clients = maps:get(RoomId, S#state.rooms, []),
            notify_presence(Clients),
            {{ok, RoomId, Clients}, S}
    end,
    {reply, Reply, NewState};

handle_call({get_clients, RoomId}, _From, State) ->
    Clients = maps:get(RoomId, State#state.rooms, []),
    {reply, Clients, State};

handle_call({get_room, Pid}, _From, State) ->
    RoomId = maps:get(Pid, State#state.client_rooms, undefined),
    {reply, RoomId, State};

handle_call({get_updates, RoomId}, _From, State) ->
    Updates = maps:get(RoomId, State#state.updates, []),
    {reply, lists:reverse(Updates), State};

handle_call(get_active_rooms, _From, State) ->
    ActiveRooms = maps:keys(State#state.rooms),
    {reply, ActiveRooms, State};

handle_call(_Request, _From, State) ->
    {reply, ok, State}.

handle_cast({add_update, RoomId, Update}, State) ->
    NewUpdates = case maps:get(RoomId, State#state.updates, undefined) of
        undefined ->
            State#state.updates;
        List ->
            (State#state.updates)#{RoomId => [Update | List]}
    end,
    {noreply, State#state{updates = NewUpdates}};

handle_cast(_Msg, State) ->
    {noreply, State}.

handle_info({'DOWN', _Ref, process, Pid, _Reason}, State) ->
    NewState = case maps:get(Pid, State#state.client_rooms, undefined) of
        undefined ->
            State;
        RoomId ->
            S = do_leave(Pid, State),
            Clients = maps:get(RoomId, S#state.rooms, []),
            notify_presence(Clients),
            S
    end,
    {noreply, NewState};

handle_info(_Info, State) ->
    {noreply, State}.

terminate(_Reason, _State) ->
    ok.

code_change(_OldVsn, State, _Extra) ->
    {ok, State}.

%% Internal functions

do_leave(Pid, State) ->
    case maps:get(Pid, State#state.client_rooms, undefined) of
        undefined ->
            State;
        RoomId ->
            Clients = maps:get(RoomId, State#state.rooms, []),
            NewClients = [{P, U, C} || {P, U, C} <- Clients, P /= Pid],
            
            {NewRooms, NewUpdates} = case NewClients of
                [] ->
                    {maps:remove(RoomId, State#state.rooms), maps:remove(RoomId, State#state.updates)};
                _ ->
                    {maps:put(RoomId, NewClients, State#state.rooms), State#state.updates}
            end,
            
            NewClientRooms = maps:remove(Pid, State#state.client_rooms),
            
            State#state{
                rooms = NewRooms,
                client_rooms = NewClientRooms,
                updates = NewUpdates
            }
    end.

notify_presence(Clients) ->
    lists:foreach(fun({Pid, _, _}) ->
        Pid ! {presence_update, Clients}
    end, Clients).
