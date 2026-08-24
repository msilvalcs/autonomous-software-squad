package fixture

import "testing"

func TestFixture(t *testing.T) {
 if 2+2 != 4 { t.Fatal("arithmetic failed") }
}
