package main

import (
	"fmt"
	"net"
	"os"
	"strconv"

	"github.com/pion/turn/v4"
)

func main() {
	port := 3478
	publicIP := "76.155.153.25"
	realm := "echoza.local"

	udpListener, err := net.ListenPacket("udp", fmt.Sprintf("0.0.0.0:%d", port))
	if err != nil {
		fmt.Println("UDP listen error:", err)
		os.Exit(1)
	}

	tcpListener, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", port))
	if err != nil {
		fmt.Println("TCP listen error:", err)
		os.Exit(1)
	}

	relayGen := &turn.RelayAddressGeneratorPortRange{
		RelayAddress: net.ParseIP(publicIP),
		Address:      "0.0.0.0",
		MinPort:      50000,
		MaxPort:      50000,
	}

	_, err = turn.NewServer(turn.ServerConfig{
		Realm: realm,
		AuthHandler: func(username, _ string, _ net.Addr) ([]byte, bool) {
			if username == "echoza" {
				return turn.GenerateAuthKey(username, realm, "echoza123"), true
			}
			return nil, false
		},
		PacketConnConfigs: []turn.PacketConnConfig{
			{
				PacketConn:            udpListener,
				RelayAddressGenerator: relayGen,
			},
		},
		ListenerConfigs: []turn.ListenerConfig{
			{
				Listener:              tcpListener,
				RelayAddressGenerator: relayGen,
			},
		},
	})
	if err != nil {
		fmt.Println("Server error:", err)
		os.Exit(1)
	}

	fmt.Println("TURN server running on 0.0.0.0:" + strconv.Itoa(port) + " (UDP + TCP)")
	fmt.Println("Public IP:", publicIP)
	fmt.Println("Realm:", realm)
	fmt.Println("Users: echoza=echoza123")
	fmt.Println("Relay port: 50000")
	select {}
}
