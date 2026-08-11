// Package web embeds the static browser frontend so it ships inside the Go
// binary with no separate file server, matching the sibling sqllab/
// schemalab/routelab demos' deployment shape.
package web

import "embed"

//go:embed index.html app.js index.ja.html app.ja.js
var Assets embed.FS
