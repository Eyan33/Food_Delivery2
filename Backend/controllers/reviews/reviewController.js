const pool = require("../../config/database");

// Create a new review (customers only; the route enforces the role)
const createReview = async (req, res) => {
    try {
        const userId = req.user.id;
        const { restaurant_id, order_id, comment } = req.body || {};
        const rating = Number(req.body && req.body.rating);
        const restaurantId = Number(restaurant_id);

        if (!Number.isInteger(restaurantId) || restaurantId <= 0) {
            return res
                .status(400)
                .json({ error: "A valid restaurant ID is required." });
        }

        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res
                .status(400)
                .json({ error: "Rating must be a whole number from 1 to 5." });
        }

        let orderId = null;

        if (order_id === undefined || order_id === null || order_id === "") {
            return res.status(400).json({ error: "Please select a delivered order to review." });
        }
        orderId = Number(order_id);
        if (!Number.isInteger(orderId) || orderId <= 0) {
            return res.status(400).json({ error: "Invalid order ID." });
        }

        const orderCheck = await pool.query(
            `SELECT id, status FROM orders WHERE id = $1 AND customer_id = $2 AND restaurant_id = $3 LIMIT 1`,
            [orderId, userId, restaurantId],
        );
        if (orderCheck.rows.length === 0) {
            return res.status(403).json({ error: "You can only review a restaurant for your own order." });
        }
        if (String(orderCheck.rows[0].status).toLowerCase() !== "delivered") {
            return res.status(400).json({ error: "You can review this restaurant after the order is delivered." });
        }
        const existingReview = await pool.query(
            "SELECT id FROM reviews WHERE order_id = $1 AND customer_id = $2 LIMIT 1",
            [orderId, userId],
        );
        if (existingReview.rows.length > 0) {
            return res.status(409).json({ error: "You have already reviewed this order." });
        }
        const trimmedComment = String(comment || "").trim().slice(0, 1000);

        const query = `
            INSERT INTO reviews (customer_id, restaurant_id, order_id, rating, comment)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *;
        `;
        const values = [userId, restaurantId, orderId, rating, trimmedComment];
        const newReview = await pool.query(query, values);

        res.status(201).json({
            message: "Review created successfully",
            review: newReview.rows[0],
        });
    } catch (err) {
        console.error(err.internalMessage || err.message);
        res.status(500).json({ error: "Server error" });
    }
};

// Reviews submitted by the signed-in customer for delivered orders.
const getMyOrderReviews = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, customer_id, restaurant_id, order_id, rating, comment, created_at FROM reviews WHERE customer_id = $1 AND order_id IS NOT NULL ORDER BY created_at DESC`,
            [req.user.id],
        );
        return res.status(200).json({ success: true, data: { reviews: result.rows } });
    } catch (err) {
        console.error("Failed to load customer's order reviews:", err.message);
        return res.status(500).json({ success: false, message: "Unable to load your reviews." });
    }
};
// Get all reviews for a specific restaurant
const getRestaurantReviews = async (req, res) => {
    try {
        const { restaurantId } = req.params;

        const query = `
            SELECT 
                reviews.*,
                CONCAT(users.first_name, ' ', users.last_name) AS customer_name
            FROM reviews
            JOIN users ON reviews.customer_id = users.id
                        WHERE restaurant_id = $1
                            AND reviews.is_visible = TRUE
            ORDER BY created_at DESC;
        `;

        const reviews = await pool.query(query, [restaurantId]);
        res.status(200).json(reviews.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Server error" });
    }
};

// Delete a review (Customer or Admin)
const deleteReview = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const reviewCheck = await pool.query(
            "SELECT * FROM reviews WHERE id = $1",
            [id],
        );
        if (reviewCheck.rows.length === 0) {
            return res.status(404).json({ error: "Review not found" });
        }

        // Ensure user owns the review or is an admin
        if (
            reviewCheck.rows[0].customer_id !== userId &&
            !["admin", "super_admin"].includes(req.user.role)
        ) {
            return res
                .status(403)
                .json({ error: "Unauthorized to delete this review" });
        }

        await pool.query("DELETE FROM reviews WHERE id = $1", [id]);
        res.status(200).json({ message: "Review deleted successfully" });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Server error" });
    }
};

module.exports = {
    createReview,
    getMyOrderReviews,
    getRestaurantReviews,
    deleteReview,
};
