FROM golang:latest AS build

COPY . /opt/build

RUN cd /opt/build; go build serv.go

FROM golang:latest

COPY --from=build /opt/build/serv /opt/serv

EXPOSE 8802

CMD [ "/opt/serv", "0.0.0.0", "8802" ]


