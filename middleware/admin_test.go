package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/service"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func TestAdminAuthStatusCodes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", JWTSecret: "middleware-test-secret"}

	user := saveAuthTestUser(t, "user", model.UserRoleUser)
	admin := saveAuthTestUser(t, "admin", model.UserRoleAdmin)
	guest := saveAuthTestUser(t, "guest", model.UserRoleGuest)
	router := gin.New()
	router.GET("/admin", AdminAuth, func(c *gin.Context) {
		c.Status(http.StatusOK)
	})
	router.GET("/user", UserAuth, func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	assertAuthStatus(t, router, "/admin", "", http.StatusUnauthorized)
	assertAuthStatus(t, router, "/admin", signAuthTestToken(t, user), http.StatusForbidden)
	assertAuthStatus(t, router, "/admin", signAuthTestToken(t, admin), http.StatusOK)
	assertAuthStatus(t, router, "/user", "", http.StatusUnauthorized)
	assertAuthStatus(t, router, "/user", signAuthTestToken(t, guest), http.StatusForbidden)
	assertAuthStatus(t, router, "/user", signAuthTestToken(t, user), http.StatusOK)
}

func saveAuthTestUser(t *testing.T, id string, role model.UserRole) model.User {
	t.Helper()
	user, err := repository.SaveUser(model.User{
		ID:        id,
		Username:  id,
		Role:      role,
		AffCode:   id + "-aff",
		Status:    model.UserStatusActive,
		CreatedAt: time.Now().Format(time.RFC3339),
		UpdatedAt: time.Now().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("save %s: %v", role, err)
	}
	return user
}

func signAuthTestToken(t *testing.T, user model.User) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, service.TokenClaims{
		UserID:   user.ID,
		Username: user.Username,
		Role:     user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})
	signed, err := token.SignedString([]byte(config.Cfg.JWTSecret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

func assertAuthStatus(t *testing.T, router http.Handler, path string, token string, want int) {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != want {
		t.Fatalf("status = %d, want %d, body = %s", recorder.Code, want, recorder.Body.String())
	}
}
