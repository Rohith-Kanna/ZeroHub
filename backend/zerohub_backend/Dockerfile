FROM erlang:26

WORKDIR /app

COPY . .

RUN rebar3 compile

EXPOSE 8080

CMD ["rebar3", "shell"]