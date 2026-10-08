package service

import "testing"

func TestUnresolvedCitationWarnings(t *testing.T) {
	for _, log := range []string{
		"LaTeX Warning: Citation `missing' on page 1 undefined on input line 15.",
		"Package natbib Warning: Citation `missing' on page 1\n(natbib)                undefined on input line 15.",
		"LaTeX Warning: There were undefined citations.",
	} {
		if !unresolvedCitationsPattern.MatchString(log) {
			t.Errorf("missed unresolved citation: %s", log)
		}
	}
	for _, log := range []string{
		"LaTeX Warning: There were undefined references.",
		"Package biblatex Warning: Please rerun LaTeX.",
		"All citations resolved.",
	} {
		if unresolvedCitationsPattern.MatchString(log) {
			t.Errorf("misidentified a citation failure: %s", log)
		}
	}
}
