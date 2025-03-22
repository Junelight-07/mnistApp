// Attendre que le DOM soit chargé
document.addEventListener('DOMContentLoaded', () => {
    // Configuration du canvas principal
    const canvas = document.getElementById('drawing-canvas');
    const ctx = canvas.getContext('2d');
    const clearButton = document.getElementById('clear-button');
    const predictButton = document.getElementById('predict-button');
    const predictionDiv = document.getElementById('prediction');
    const loadingDiv = document.getElementById('loading');
    const invertColorsCheckbox = document.getElementById('invert-colors');

    // Canvas pour le débogage/visualisation
    const processedCanvas = document.getElementById('processed-canvas');
    const processedCtx = processedCanvas.getContext('2d');

    // État des couleurs
    let isInverted = false;

    // Fonction pour mettre à jour les couleurs du canvas
    function updateCanvasColors() {
        if (isInverted) {
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = 'black';
        } else {
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = 'white';
        }
    }

    // Configuration initiale du canvas
    updateCanvasColors();
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Gérer le changement de mode de couleur
    invertColorsCheckbox.addEventListener('change', () => {
        isInverted = invertColorsCheckbox.checked;
        updateCanvasColors();
    });

    // Variables pour le dessin
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    // Fonctions de dessin
    function startDrawing(e) {
        isDrawing = true;
        [lastX, lastY] = [e.offsetX, e.offsetY];
    }

    function draw(e) {
        if (!isDrawing) return;

        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(e.offsetX, e.offsetY);
        ctx.stroke();

        [lastX, lastY] = [e.offsetX, e.offsetY];
    }

    function stopDrawing() {
        isDrawing = false;
    }

    // Gestion des événements tactiles
    function getTouchPos(canvas, touchEvent) {
        const rect = canvas.getBoundingClientRect();
        return {
            offsetX: touchEvent.touches[0].clientX - rect.left,
            offsetY: touchEvent.touches[0].clientY - rect.top
        };
    }

    function touchStart(e) {
        e.preventDefault();
        const touch = getTouchPos(canvas, e);
        startDrawing(touch);
    }

    function touchMove(e) {
        e.preventDefault();
        const touch = getTouchPos(canvas, e);
        draw(touch);
    }

    // Ajout des écouteurs d'événements
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    // Support tactile
    canvas.addEventListener('touchstart', touchStart);
    canvas.addEventListener('touchmove', touchMove);
    canvas.addEventListener('touchend', stopDrawing);

    // Effacer le canvas
    clearButton.addEventListener('click', () => {
        updateCanvasColors(); // Utiliser la bonne couleur de fond
        predictionDiv.textContent = '';

        // Effacer aussi le canvas de débogage
        processedCtx.clearRect(0, 0, processedCanvas.width, processedCanvas.height);
    });

    // Fonction de prétraitement d'image améliorée
    function preprocessImage() {
        // Créer un canvas temporaire de 28x28 pixels (taille MNIST)
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 28;
        tempCanvas.height = 28;
        const tempCtx = tempCanvas.getContext('2d');

        // Dessiner l'image du canvas original vers le petit canvas
        if (isInverted) {
            tempCtx.fillStyle = 'white';
        } else {
            tempCtx.fillStyle = 'black';
        }
        tempCtx.fillRect(0, 0, 28, 28);
        tempCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 28, 28);

        // Obtenir les données de l'image
        const imageData = tempCtx.getImageData(0, 0, 28, 28);
        const data = imageData.data;

        // Créer un tableau pour stocker les valeurs de gris (0=noir, 1=blanc)
        const grayscaleData = new Float32Array(28 * 28);

        // 1. Convertir RGBA en nuances de gris
        for (let i = 0; i < 28 * 28; i++) {
            // La luminance est généralement R*0.299 + G*0.587 + B*0.114
            // Mais R=G=B pour nos dessins en niveaux de gris
            grayscaleData[i] = data[i * 4] / 255.0;

            // Si mode inversé, inverser les valeurs (car MNIST s'attend à fond noir, chiffres blancs)
            if (isInverted) {
                grayscaleData[i] = 1.0 - grayscaleData[i];
            }
        }

        // 2. Dilater l'image pour rendre les traits plus épais
        const dilatedData = dilateImage(grayscaleData, 28, 28);

        // 3. Normaliser comme MNIST
        const normalizedData = new Float32Array(28 * 28);
        for (let i = 0; i < 28 * 28; i++) {
            // Appliquer la normalisation MNIST (moyenne=0.1307, écart-type=0.3081)
            normalizedData[i] = (dilatedData[i] - 0.1307) / 0.3081;
        }

        // Afficher l'image prétraitée
        displayProcessedImage(dilatedData); // Afficher avant normalisation pour meilleure visualisation

        // Préparer le format pour ONNX (format [batch, channels, height, width])
        const tensor = new Float32Array(1 * 1 * 28 * 28);
        for (let i = 0; i < 28 * 28; i++) {
            tensor[i] = normalizedData[i];
        }

        return tensor;
    }

    // Fonction pour dilater l'image (épaissir les traits)
    function dilateImage(imageData, width, height) {
        const result = new Float32Array(width * height);

        // Copier d'abord les données originales
        for (let i = 0; i < width * height; i++) {
            result[i] = imageData[i];
        }

        // Appliquer la dilatation
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;

                // Si le pixel est significativement non-noir
                if (imageData[idx] > 0.3) {
                    // Dilater dans toutes les directions (8-connectivité)
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const targetIdx = (y + dy) * width + (x + dx);
                            // Mettre les pixels voisins à blanc (ou valeur originale si plus élevée)
                            result[targetIdx] = Math.max(result[targetIdx], 0.9);
                        }
                    }
                }
            }
        }

        return result;
    }

    // Afficher l'image prétraitée
    function displayProcessedImage(grayscaleData) {
        // Effacer le canvas de prévisualisation
        processedCtx.clearRect(0, 0, processedCanvas.width, processedCanvas.height);
        processedCtx.fillStyle = 'black';
        processedCtx.fillRect(0, 0, processedCanvas.width, processedCanvas.height);

        // Créer un nouvel ImageData pour afficher l'image prétraitée
        const imageData = processedCtx.createImageData(28, 28);
        const data = imageData.data;

        // Trouver min et max pour améliorer la visualisation
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < 28 * 28; i++) {
            min = Math.min(min, grayscaleData[i]);
            max = Math.max(max, grayscaleData[i]);
        }

        // Normaliser pour l'affichage
        for (let i = 0; i < 28 * 28; i++) {
            // Renormaliser pour l'affichage avec contraste amélioré
            // D'abord, annuler la normalisation MNIST
            let pixelValue = grayscaleData[i];

            // Contraindre entre 0 et 1
            pixelValue = Math.max(0, Math.min(1, pixelValue));

            // Convertir en valeur entre 0 et 255
            const value = Math.round(pixelValue * 255);

            // Définir RGBA
            data[i * 4] = value;     // R
            data[i * 4 + 1] = value; // G
            data[i * 4 + 2] = value; // B
            data[i * 4 + 3] = 255;   // Alpha (opacité)
        }

        // Créer un canvas temporaire pour l'image 28x28
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 28;
        tempCanvas.height = 28;
        const tempCtx = tempCanvas.getContext('2d');

        // Mettre l'imageData sur le canvas temporaire
        tempCtx.putImageData(imageData, 0, 0);

        // Dessiner sur le canvas de prévisualisation avec antialiasing désactivé
        processedCtx.imageSmoothingEnabled = false;
        processedCtx.drawImage(tempCanvas, 0, 0, 28, 28, 0, 0, processedCanvas.width, processedCanvas.height);

        // Ajouter une grille pour mieux visualiser les pixels
        processedCtx.strokeStyle = 'rgba(100, 100, 100, 0.3)';
        processedCtx.lineWidth = 0.5;

        // Tracer des lignes horizontales et verticales pour la grille
        const cellSize = processedCanvas.width / 28;
        for (let i = 0; i <= 28; i++) {
            const pos = i * cellSize;

            // Ligne horizontale
            processedCtx.beginPath();
            processedCtx.moveTo(0, pos);
            processedCtx.lineTo(processedCanvas.width, pos);
            processedCtx.stroke();

            // Ligne verticale
            processedCtx.beginPath();
            processedCtx.moveTo(pos, 0);
            processedCtx.lineTo(pos, processedCanvas.height);
            processedCtx.stroke();
        }
    }

    // Faire une prédiction avec ONNX Runtime
    async function predict() {
        try {
            // Prétraiter l'image
            const inputTensor = preprocessImage();

            // Charger le modèle
            const session = await ort.InferenceSession.create('mnist_model.onnx');

            // Préparer les entrées
            const dims = [1, 1, 28, 28];
            const input = new ort.Tensor('float32', inputTensor, dims);

            // Obtenir le nom de l'entrée/sortie à partir du modèle
            const inputName = session.inputNames[0];
            const outputName = session.outputNames[0];

            console.log("Noms d'entrée du modèle:", session.inputNames);
            console.log("Noms de sortie du modèle:", session.outputNames);

            // Exécuter l'inférence avec les noms corrects
            const feeds = {};
            feeds[inputName] = input;
            const results = await session.run(feeds);

            // Trouver la classe avec la plus haute probabilité
            const output = results[outputName].data;
            let maxProb = -Infinity;
            let predictedClass = -1;

            for (let i = 0; i < 10; i++) {
                if (output[i] > maxProb) {
                    maxProb = output[i];
                    predictedClass = i;
                }
            }

            return predictedClass;
        } catch (error) {
            console.error('Erreur lors de la prédiction:', error);
            return -1;
        }
    }

    // Bouton de prédiction
    predictButton.addEventListener('click', async () => {
        predictionDiv.textContent = '';
        loadingDiv.style.display = 'block';

        try {
            const prediction = await predict();
            loadingDiv.style.display = 'none';

            if (prediction !== -1) {
                predictionDiv.textContent = `Prédiction: ${prediction}`;
            } else {
                predictionDiv.textContent = 'Erreur lors de la prédiction';
            }
        } catch (error) {
            loadingDiv.style.display = 'none';
            predictionDiv.textContent = 'Erreur lors de la prédiction';
            console.error('Erreur:', error);
        }
    });
});