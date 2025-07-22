# SpaceWar Strategy Game

[![Gameplay Screenshot](https://img.itch.zone/aW1nLzIyMTgyMjc3LmpwZw==/original/EG3tJS.jpg)](https://pecatus.itch.io/spacewar)

A real-time 4X space strategy game prototype refactored into a full client-server architecture. This project was created as a skills demonstration for a degree in software development.

### [➡️ Play the Game on itch.io!](https://pecatus.itch.io/spacewar)

---

## About The Project

This project is a complete refactoring of an earlier client-side prototype. The primary goal was to rebuild the game using a modern client-server architecture with a Node.js backend managing the authoritative game state and a Three.js frontend for rendering.

**Key Features:**
* **Authoritative Server:** All game logic, including economy, combat, and construction, is handled by the server to prevent cheating.
* **Real-time Updates:** Uses Socket.IO for instant, real-time communication between the client and server.
* **Dynamic AI:** The AI opponent analyzes the galaxy-wide threat level and builds strategic counter-units.
* **Immersive Tutorial:** An event-driven tutorial system with character advisors guides the player through the game.
* **3D Visuals:** The game world is rendered using Three.js, with visual effects for combat, movement, and UI feedback.

## Technologies Used

The project is built with the MERN stack in mind, but with a vanilla JavaScript frontend.

**Frontend:**
* **HTML5 & CSS3** (Styled with Tailwind CSS)
* **JavaScript (ESM)**
* **Three.js:** For 3D rendering.
* **Tone.js:** For audio effects.
* **Tween.js:** For smooth animations.

**Backend:**
* **Node.js:** JavaScript runtime environment.
* **Express.js:** Web server framework for the API.
* **Socket.IO:** Real-time communication library.
* **MongoDB:** NoSQL database for storing game state.
* **Mongoose:** Object Data Modeling (ODM) for MongoDB.

**Testing:**
* **Jest:** For backend unit testing.

---

## Local Setup and Usage

To run the project on your local machine, you need to set up both the backend and the frontend.

### Backend Setup

1.  **Clone the repository:**
    ```bash
    git clone [Your-Repo-URL]
    ```
2.  **Navigate to the backend folder:**
    ```bash
    cd SpaceWar_Refactored/backend
    ```
3.  **Install dependencies:**
    ```bash
    npm install
    ```
4.  **Create an environment file:** Create a file named `.env` in the `backend` folder and add your MongoDB connection string and a session secret:
    ```
    MONGO_URI="your_mongodb_connection_string"
    SESSION_SECRET="a_long_random_secret_string_for_sessions"
    ```
5.  **Run the server:**
    ```bash
    npm start
    ```
    The server will be running at `http://localhost:3001`.

6.  **Run tests (optional):**
    ```bash
    npm test
    ```

### Frontend Setup

1.  **Open `index.html`:** The frontend can be run by opening the `index.html` file in the project's root directory with a live server extension (like "Live Server" for VS Code) to handle CORS correctly.
2.  **Update Backend URL:** For local development, make sure to change the `BACKEND_URL` constant in `frontend/js/client.js` to point to your local server:
    ```javascript
    const BACKEND_URL = "http://localhost:3001";
    ```

---

## License

The source code for this project is licensed under the **MIT License**.

## Author

**Lasse Simonen**