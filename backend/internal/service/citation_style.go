package service

import (
	_ "embed"
	"strings"
)

//go:embed csl/numeric.csl
var numericCSL string

//go:embed csl/apa.csl
var apaCSL string

// wordCitationCSL returns the CSL used for Word export; "" keeps Pandoc's default author–date style.
func wordCitationCSL(style string) string {
	switch style {
	case "unsrt", "ieee":
		return strings.Replace(numericCSL, "__SORT__", "", 1)
	case "plain":
		return strings.Replace(numericCSL, "__SORT__", `<sort><key macro="author"/><key variable="issued"/><key variable="title"/></sort>`, 1)
	case "apa":
		return apaCSL
	default:
		return ""
	}
}
