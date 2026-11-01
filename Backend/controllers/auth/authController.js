const authService = require("../../services/auth/authService");
const emailService = require("../../services/emailService");


async function register(req, res) {
    try {

        const {
            first_name,
            last_name,
            email,
            phone,
            password
        } = req.body;

        const result = await authService.registerUser({
            first_name,
            last_name,
            email,
            phone,
            password
        });

        return res.status(201).json({
            success: true,
            message: "Account created successfully",
            data: result
        });

    } catch (error) {

        console.error("Registration error:", error);

        if (error.code === "23505") {
            return res.status(409).json({
                success: false,
                message: "An account with this email or phone already exists"
            });
        }

        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
}


async function login(req, res) {
    try {

        const {
            email,
            password
        } = req.body;

        const result = await authService.loginUser({
            email,
            password
        });

        return res.status(200).json({
            success: true,
            message: "Login successful",
            data: result
        });

    } catch (error) {

        console.error("Login error:", error);

        return res.status(401).json({
            success: false,
            message: error.message
        });
    }
}


async function googleConfig(req, res) {
    const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
    if (!clientId) return res.status(503).json({ success: false, message: "Google sign-in is not configured" });
    return res.status(200).json({ success: true, data: { clientId } });
}
async function googleLogin(req, res) {
    try {
        const result = await authService.loginWithGoogleCredential(req.body && req.body.credential);
        return res.status(200).json({ success: true, message: "Google sign-in successful", data: result });
    } catch (error) {
        console.error("Google sign-in error:", error.message);
        const notConfigured = /not configured/i.test(error.message);
        return res.status(notConfigured ? 503 : 401).json({ success: false, message: error.message || "Google sign-in failed" });
    }
}
async function setGooglePassword(req, res) {
    try {
        await authService.setGoogleAccountPassword(req.user.id, req.body && req.body.newPassword);
        return res.status(200).json({ success: true, message: "Password created successfully." });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
}

async function finishGoogleFirstSession(req, res) {
    try {
        await authService.finishGoogleFirstSession(req.user.id);
        return res.status(200).json({ success: true, message: "First session ended." });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Unable to finish session." });
    }
}

async function me(req, res) {
    try {

        const user = await authService.getCurrentUser(
            req.user.id
        );

        return res.status(200).json({
            success: true,
            data: {
                user
            }
        });

    } catch (error) {

        console.error("Get current user error:", error);

        return res.status(401).json({
            success: false,
            message: error.message
        });
    }
}


async function updateMe(req, res) {
    try {
        const user = await authService.updateCurrentUser(
            req.user.id,
            req.body
        );

        return res.status(200).json({
            success: true,
            message: "Profile updated successfully",
            data: { user }
        });
    } catch (error) {
        console.error("Update profile error:", error);

        if (error.code === "23505") {
            return res.status(409).json({
                success: false,
                message: "An account with this email or phone already exists"
            });
        }

        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
}

async function changePassword(req, res) {
    try {
        const { currentPassword, newPassword } = req.body || {};

        const result = await authService.changeCurrentUserPassword(
            req.user.id,
            currentPassword,
            newPassword
        );

        // Admin accounts get a fresh token because their old sessions end.
        return res.status(200).json({
            success: true,
            message: "Password changed successfully",
            ...(result && result.token ? { data: { token: result.token } } : {})
        });
    } catch (error) {
        console.error("Change password error:", error);

        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
}



async function forgotPassword(req, res) {
    const genericMessage =
        "If an active account exists for that email, password-reset instructions will be sent.";

    try {
        const email = req.body && req.body.email;
        const resetRequest = await authService.createPasswordResetToken(email);

        if (resetRequest) {
            const frontendUrl = String(
                process.env.FRONTEND_URL || "https://food-delivery-tcwn.onrender.com"
            ).replace(/\/+$/, "");
            const resetUrl = `${frontendUrl}/pages/auth/reset-password.html?token=${encodeURIComponent(resetRequest.token)}`;

            try {
                await emailService.sendPasswordResetEmail({
                    to: resetRequest.email,
                    resetUrl
                });
            } catch (emailError) {
                await authService.deletePasswordResetToken(resetRequest.token).catch(() => {});
                console.error("Password reset email delivery failed:", emailError.message);
            }
        }

        return res.status(200).json({ success: true, message: genericMessage });
    } catch (error) {
        if (/valid email address/i.test(error.message)) {
            return res.status(400).json({ success: false, message: error.message });
        }

        console.error("Forgot password error:", error.message);
        return res.status(200).json({ success: true, message: genericMessage });
    }
}

async function resetPassword(req, res) {
    try {
        const { token, newPassword } = req.body || {};
        await authService.resetPasswordWithToken(token, newPassword);

        return res.status(200).json({
            success: true,
            message: "Your password has been reset. You can now log in with your new password."
        });
    } catch (error) {
        const message = error.message || "Unable to reset password.";
        return res.status(400).json({
            success: false,
            message
        });
    }
}


module.exports = {
    register,
    login,
    googleConfig,
    googleLogin,
    setGooglePassword,
    finishGoogleFirstSession,
    me,
    updateMe,
    changePassword,
    forgotPassword,
    resetPassword
};