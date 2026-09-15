const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const REDIRECT_URI =
  process.env.GITHUB_REDIRECT_URI || "http://localhost:5000/auth/github/callback";
// repo -> read access to public + private repos. read:user NOT requested: the
// /user endpoint returns public fields (login, avatar_url, id) on any
// authenticated request, which is all CodeLens stores.
const GITHUB_SCOPE = "repo";

function setTokenCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    // httponly JWT cookie: only sent over HTTPS when running in production.
    // In dev (localhost over http) this must be false or the cookie gets dropped.
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearTokenCookie(res) {
  res.clearCookie("token", { httpOnly: true, sameSite: "lax", path: "/" });
}

// Redirects to GitHub's OAuth authorize screen. A random `state` value is set as
// a short-lived cookie so the callback can reject cross-site request forgery.
router.get("/github", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");

  res.cookie("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
  });

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: GITHUB_SCOPE,
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GitHub redirects here after the user approves/denies. Exchanges the code for an
// access token, upserts the User, issues a JWT (httpOnly cookie), and returns the
// browser to the client.
router.get("/github/callback", async (req, res) => {
  const { code, state } = req.query;
  const expectedState = req.cookies?.oauth_state;
  res.clearCookie("oauth_state");

  if (!code || !state || state !== expectedState) {
    console.error("GitHub OAuth state mismatch or missing code");
    return res.redirect(`${CLIENT_ORIGIN}?error=invalid_oauth_state`);
  }

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error || "Token exchange failed");
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "CodeLens",
      },
    });
    if (!userRes.ok) {
      throw new Error("Failed to fetch GitHub profile");
    }
    const ghUser = await userRes.json();

    const user = await User.findOneAndUpdate(
      { githubId: String(ghUser.id) },
      {
        $set: {
          username: ghUser.login,
          avatarUrl: ghUser.avatar_url,
          accessToken: tokenData.access_token,
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    const token = jwt.sign(
      {
        sub: user._id.toString(),
        githubId: user.githubId,
        username: user.username,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    setTokenCookie(res, token);
    res.redirect(CLIENT_ORIGIN);
  } catch (err) {
    console.error("GitHub OAuth error:", err.message);
    res.redirect(`${CLIENT_ORIGIN}?error=oauth_failed`);
  }
});

// Protected — returns the logged-in user's profile if the JWT cookie is valid.
router.get("/me", requireAuth, (req, res) => {
  const { _id, githubId, username, avatarUrl, createdAt } = req.user;
  res.json({
    user: {
      id: _id.toString(),
      githubId,
      username,
      avatarUrl,
      createdAt,
    },
  });
});

router.post("/logout", (_req, res) => {
  clearTokenCookie(res);
  res.json({ ok: true });
});

module.exports = router;