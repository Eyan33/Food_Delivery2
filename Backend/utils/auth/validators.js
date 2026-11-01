function normalizeEmail(email) {
    return String(email || "")
        .trim()
        .toLowerCase();
}


function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    return emailRegex.test(email);
}


function isValidPassword(password) {
    return (
        typeof password === "string" &&
        password.length >= 8
    );
}


/*
 * Privileged accounts need stronger passwords than customers. The super
 * admin is a single break-glass account, so it matches the 16 characters
 * required when it is seeded; admins match the 8-character minimum required for ADMIN_PASSWORD.
 */
const PRIVILEGED_ROLES = ["admin", "super_admin"];

const MIN_PASSWORD_LENGTH_BY_ROLE = {
    super_admin: 16,
    admin: 8
};

function isPrivilegedRole(role) {
    return PRIVILEGED_ROLES.includes(role);
}

function minPasswordLengthForRole(role) {
    return MIN_PASSWORD_LENGTH_BY_ROLE[role] || 8;
}

function isValidPasswordForRole(password, role) {
    return (
        typeof password === "string" &&
        password.length >= minPasswordLengthForRole(role)
    );
}

function passwordRequirementMessage(role) {
    return `Password must contain at least ${minPasswordLengthForRole(role)} characters`;
}


function isValidName(name) {
    return (
        typeof name === "string" &&
        name.trim().length >= 2
    );
}


function isValidPhone(phone) {
    if (
        phone === null ||
        phone === undefined ||
        phone === ""
    ) {
        return true;
    }

    return (
        typeof phone === "string" &&
        phone.trim().length >= 7
    );
}


module.exports = {
    normalizeEmail,
    isValidEmail,
    isValidPassword,
    isPrivilegedRole,
    minPasswordLengthForRole,
    isValidPasswordForRole,
    passwordRequirementMessage,
    isValidName,
    isValidPhone
};
