package com.jarves.ai

import android.app.Activity
import android.app.ActivityManager
import android.app.AlertDialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InterruptedIOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class LocalAiActivity : Activity() {
    private data class SavedMessage(val role: String, val content: String, val display: String)
    private data class Mode(val label: String, val instruction: String)

    companion object {
        private const val TAG = "JARVES-LocalAI"
        private const val MODEL_SIZE = 2_588_147_712L
        private const val STORAGE_RESERVE = 512L * 1024 * 1024
        private const val MODEL_SHA256 = "181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c"
        private const val MODEL_URL =
            "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/" +
                "1caa527c1e88b55f046fcd8d2b4265606680663d/gemma-4-E2B-it.litertlm"
        private const val HISTORY_KEY = "local_ai_history_v1"
        private const val MAX_HISTORY_MESSAGES = 12
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "jarves-local-model")
    }
    private val cancelDownload = AtomicBoolean(false)
    private val modes = listOf(
        Mode("Chat", "Responda em português com clareza e seja honesto quando não souber."),
        Mode("Código", "Ajude com programação. Explique suposições e mostre código legível."),
        Mode("Resumo", "Resuma o conteúdo em tópicos objetivos sem inventar fatos."),
        Mode("Traduzir", "Traduza fielmente para português, preservando o sentido e o formato."),
        Mode("Plano", "Organize a solicitação em etapas práticas e indique dependências.")
    )
    private val modelFile: File by lazy {
        File(noBackupFilesDir, "gemma-4-E2B-it.litertlm")
    }
    private val partialFile: File by lazy {
        File(noBackupFilesDir, "gemma-4-E2B-it.litertlm.part")
    }

    @Volatile private var destroyed = false
    @Volatile private var downloading = false
    @Volatile private var activeConnection: HttpURLConnection? = null
    private var engine: Engine? = null
    private var conversation: Conversation? = null
    private var activeMode = 0
    private var isGenerating = false
    private var historyCorrupt = false
    private val history = ArrayList<SavedMessage>()

    private lateinit var modelStatus: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var modelButton: Button
    private lateinit var removeModelButton: Button
    private lateinit var sendButton: Button
    private lateinit var input: EditText
    private lateinit var chatMessages: LinearLayout
    private lateinit var chatScroll: ScrollView
    private lateinit var modesContainer: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        history.addAll(readHistory())
        buildUi()
        renderHistory()
        refreshModelPanel()
        if (modelFile.isFile && modelFile.length() == MODEL_SIZE) confirmModelLoad()
    }

    override fun onDestroy() {
        destroyed = true
        cancelDownload.set(true)
        activeConnection?.disconnect()
        ioExecutor.shutdownNow()
        releaseEngineInBackground()
        super.onDestroy()
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(8, 13, 26))
            setPadding(dp(14), dp(8), dp(14), dp(10))
        }

        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        toolbar.addView(makeButton("‹ Voltar") { finish() })
        val title = TextView(this).apply {
            text = "JARVES · IA local"
            setTextColor(Color.WHITE)
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        toolbar.addView(title, LinearLayout.LayoutParams(0, dp(48), 1f))
        toolbar.addView(makeButton("Nova conversa") { confirmNewChat() })
        root.addView(toolbar)

        val modeScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            setPadding(0, dp(4), 0, dp(4))
        }
        modesContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        modes.forEachIndexed { index, mode ->
            val button = makeButton(mode.label) { selectMode(index) }
            button.tag = index
            modesContainer.addView(button, LinearLayout.LayoutParams(-2, dp(42)).apply {
                marginEnd = dp(7)
            })
        }
        modeScroll.addView(modesContainer)
        root.addView(modeScroll)

        val modelPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(8), dp(12), dp(8))
            background = rounded(0xFF10182A.toInt(), 14)
        }
        modelStatus = TextView(this).apply {
            setTextColor(0xFFCED8EF.toInt())
            textSize = 12f
        }
        modelPanel.addView(modelStatus)
        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
        }
        modelPanel.addView(progressBar, LinearLayout.LayoutParams(-1, dp(6)).apply {
            topMargin = dp(7)
        })
        val modelActions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        modelButton = makeButton("Baixar modelo") { onModelButtonClicked() }
        modelActions.addView(modelButton, LinearLayout.LayoutParams(0, dp(44), 1f))
        removeModelButton = makeButton("Remover") { confirmRemoveModel() }
        modelActions.addView(removeModelButton, LinearLayout.LayoutParams(-2, dp(44)).apply {
            marginStart = dp(7)
        })
        modelPanel.addView(modelActions)
        root.addView(modelPanel, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(5)
            bottomMargin = dp(8)
        })

        chatScroll = ScrollView(this).apply {
            isFillViewport = true
            clipToPadding = false
        }
        chatMessages = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(2), dp(4), dp(2), dp(12))
        }
        chatScroll.addView(chatMessages, ScrollView.LayoutParams(-1, -2))
        root.addView(chatScroll, LinearLayout.LayoutParams(-1, 0, 1f))

        val composer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.BOTTOM
            setPadding(0, dp(8), 0, 0)
        }
        input = EditText(this).apply {
            hint = "Pergunte ao modelo que está no celular..."
            setTextColor(Color.WHITE)
            setHintTextColor(0xFF8997B0.toInt())
            textSize = 15f
            minLines = 1
            maxLines = 5
            setPadding(dp(12), dp(9), dp(12), dp(9))
            background = rounded(0xFF151F34.toInt(), 12)
            filters = arrayOf(android.text.InputFilter.LengthFilter(4000))
        }
        composer.addView(input, LinearLayout.LayoutParams(0, -2, 1f))
        sendButton = makeButton("Enviar") { sendMessage() }
        composer.addView(sendButton, LinearLayout.LayoutParams(-2, dp(48)).apply {
            marginStart = dp(7)
        })
        root.addView(composer)

        val privacy = TextView(this).apply {
            text = "A inferência e o histórico ficam no celular. Internet só é usada para baixar o modelo."
            setTextColor(0xFF8190AA.toInt())
            textSize = 10f
            setPadding(dp(3), dp(6), dp(3), 0)
        }
        root.addView(privacy)
        setContentView(root)
        selectMode(0)
    }

    private fun refreshModelPanel() {
        if (Build.SUPPORTED_64_BIT_ABIS.isEmpty()) {
            modelStatus.text = "A IA local exige Android 64-bit; você ainda pode usar o modo Servidor no computador."
            modelButton.text = "IA local indisponível"
            modelButton.isEnabled = false
            progressBar.visibility = if (downloading) View.VISIBLE else View.GONE
            removeModelButton.visibility = if (modelFile.exists() || partialFile.exists()) View.VISIBLE else View.GONE
            return
        }
        if (downloading) {
            modelStatus.text = "Baixando Gemma 4 E2B · 2,59 GB. O download parcial pode ser retomado."
            modelButton.text = "Cancelar download"
            modelButton.isEnabled = true
            removeModelButton.visibility = View.VISIBLE
            progressBar.visibility = View.VISIBLE
            return
        }
        progressBar.visibility = View.GONE
        when {
            engine != null -> {
                modelStatus.text = "Modelo carregado · Gemma 4 E2B · LiteRT-LM · Apache-2.0"
                modelButton.text = "Modelo pronto"
                modelButton.isEnabled = false
                removeModelButton.visibility = View.VISIBLE
            }
            modelFile.isFile && modelFile.length() == MODEL_SIZE -> {
                modelStatus.text =
                    "Modelo verificado · 2,59 GB · Gemma 4 E2B · Apache-2.0 · execução local"
                modelButton.text = "Iniciar modelo local"
                modelButton.isEnabled = true
                removeModelButton.visibility = View.VISIBLE
            }
            modelFile.exists() -> {
                modelStatus.text = "O arquivo do modelo não passou na validação. Remova-o antes de baixar novamente."
                modelButton.text = "Modelo inválido"
                modelButton.isEnabled = false
                removeModelButton.visibility = View.VISIBLE
            }
            partialFile.exists() && partialFile.length() > 0L -> {
                val percent = (partialFile.length() * 100 / MODEL_SIZE).toInt().coerceIn(0, 99)
                modelStatus.text =
                    "Download interrompido em $percent% · ${formatBytes(partialFile.length())} de 2,59 GB."
                modelButton.text = "Continuar download"
                modelButton.isEnabled = true
                removeModelButton.visibility = View.VISIBLE
            }
            else -> {
                modelStatus.text =
                    "Modelo local Gemma 4 E2B · 2,59 GB · Apache-2.0. Baixe uma vez; depois funciona sem internet."
                modelButton.text = "Baixar modelo (2,59 GB)"
                modelButton.isEnabled = true
                removeModelButton.visibility = View.GONE
            }
        }
    }

    private fun onModelButtonClicked() {
        if (downloading) {
            cancelDownload.set(true)
            activeConnection?.disconnect()
            modelButton.isEnabled = false
            modelStatus.text = "Cancelando com segurança; o progresso parcial será mantido."
            return
        }
        if (modelFile.isFile && modelFile.length() == MODEL_SIZE) {
            if (engine == null) confirmModelLoad() else setStatus("O modelo local já está pronto.")
            return
        }
        if (modelFile.exists()) return
        confirmModelDownload()
    }

    private fun confirmModelDownload() {
        AlertDialog.Builder(this)
            .setTitle("Baixar IA local")
            .setMessage(
                "O modelo oficial Gemma 4 E2B ocupa 2,59 GB e precisa de mais 512 MB livres durante o download. " +
                    "Ele será salvo no armazenamento privado do app. Wi-Fi é recomendado; depois do download, " +
                    "as conversas funcionam offline e não são enviadas a um servidor."
            )
            .setPositiveButton("Baixar modelo") { _, _ -> downloadModel() }
            .setNegativeButton("Agora não", null)
            .show()
    }

    private fun downloadModel() {
        val requiredBytes = MODEL_SIZE + STORAGE_RESERVE
        val availableBytes = try {
            StatFs(noBackupFilesDir.path).availableBytes
        } catch (error: IllegalArgumentException) {
            showError("Não consegui verificar o espaço livre: ${error.message ?: "armazenamento indisponível"}.")
            return
        }
        if (availableBytes < requiredBytes) {
            showError(
                "Espaço insuficiente: são necessários ${formatBytes(requiredBytes)} livres; " +
                    "há ${formatBytes(availableBytes)} disponíveis."
            )
            return
        }

        cancelDownload.set(false)
        downloading = true
        refreshModelPanel()
        progressBar.progress = 0
        ioExecutor.execute {
            try {
                downloadAndVerifyModel()
                mainHandler.post {
                    if (destroyed) return@post
                    downloading = false
                    progressBar.progress = 100
                    modelStatus.text = "Download e checksum SHA-256 verificados. Inicializando o modelo..."
                    refreshModelPanel()
                    initializeModel()
                }
            } catch (error: InterruptedIOException) {
                Log.i(TAG, "Download local pausado.", error)
                mainHandler.post {
                    if (destroyed) return@post
                    downloading = false
                    refreshModelPanel()
                    setStatus("Download interrompido; toque em Continuar download para retomar.")
                }
            } catch (error: IOException) {
                Log.e(TAG, "Falha ao baixar ou verificar o modelo local.", error)
                mainHandler.post {
                    if (destroyed) return@post
                    downloading = false
                    refreshModelPanel()
                    showError("Falha no download do modelo: ${error.message ?: "erro de rede ou integridade"}.")
                }
            } catch (error: GeneralSecurityException) {
                Log.e(TAG, "O algoritmo de checksum SHA-256 não está disponível.", error)
                mainHandler.post {
                    if (destroyed) return@post
                    downloading = false
                    refreshModelPanel()
                    showError("Não foi possível verificar a integridade do modelo: ${error.message ?: "SHA-256 indisponível"}.")
                }
            } catch (error: SecurityException) {
                Log.e(TAG, "Sem permissão para salvar o modelo local.", error)
                mainHandler.post {
                    if (destroyed) return@post
                    downloading = false
                    refreshModelPanel()
                    showError("Sem permissão para salvar o modelo: ${error.message ?: "acesso negado"}.")
                }
            }
        }
    }

    @Throws(IOException::class)
    private fun downloadAndVerifyModel() {
        var offset = partialFile.takeIf { it.isFile }?.length() ?: 0L
        if (offset > MODEL_SIZE) {
            if (!partialFile.delete()) throw IOException("Não foi possível remover o arquivo parcial inválido.")
            offset = 0L
        }

        val digest = MessageDigest.getInstance("SHA-256")
        if (offset > 0L) {
            FileInputStream(partialFile).use { existing ->
                val buffer = ByteArray(1024 * 1024)
                while (true) {
                    val read = existing.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                }
            }
        }
        if (offset == MODEL_SIZE) {
            val actualHash = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
            if (!actualHash.equals(MODEL_SHA256, ignoreCase = true)) {
                partialFile.delete()
                throw IOException("Checksum SHA-256 do download retomado não confere; o arquivo inválido foi descartado.")
            }
            if (!partialFile.renameTo(modelFile)) {
                throw IOException("Não foi possível finalizar o arquivo de modelo validado.")
            }
            return
        }

        val connection = (URL(MODEL_URL).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20_000
            readTimeout = 60_000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "JARVES-AI-Android/2.4.0")
            if (offset > 0L) setRequestProperty("Range", "bytes=$offset-")
        }
        activeConnection = connection
        try {
            val responseCode = connection.responseCode
            if (!"https".equals(connection.url.protocol, ignoreCase = true)) {
                throw IOException("O servidor de modelos tentou usar uma conexão sem HTTPS.")
            }
            val startAt = when {
                responseCode == HttpURLConnection.HTTP_OK -> 0L
                responseCode == HttpURLConnection.HTTP_PARTIAL && offset > 0L -> {
                    val contentRange = connection.getHeaderField("Content-Range").orEmpty()
                    if (!contentRange.startsWith("bytes $offset-")) {
                        throw IOException("Resposta de retomada inválida: $contentRange")
                    }
                    offset
                }
                else -> throw IOException("Servidor do modelo respondeu HTTP $responseCode.")
            }
            if (startAt == 0L && partialFile.exists() && !partialFile.delete()) {
                throw IOException("Não foi possível reiniciar o arquivo parcial.")
            }
            if (startAt == 0L) digest.reset()
            val expectedResponseBytes = MODEL_SIZE - startAt
            val responseLength = connection.contentLengthLong
            if (responseLength >= 0L && responseLength != expectedResponseBytes) {
                throw IOException(
                    "Tamanho informado pelo servidor não corresponde ao modelo fixado " +
                        "($responseLength bytes restantes)."
                )
            }
            var downloadedBytes = startAt
            var lastUiUpdate = 0L
            connection.inputStream.use { inputStream ->
                FileOutputStream(partialFile, startAt > 0L).use { outputStream ->
                    val buffer = ByteArray(1024 * 1024)
                    while (true) {
                        if (cancelDownload.get() || Thread.currentThread().isInterrupted) {
                            throw InterruptedIOException("Download cancelado.")
                        }
                        val read = inputStream.read(buffer)
                        if (read < 0) break
                        downloadedBytes += read
                        if (downloadedBytes > MODEL_SIZE) {
                            throw IOException("O arquivo recebido é maior que o modelo esperado.")
                        }
                        digest.update(buffer, 0, read)
                        outputStream.write(buffer, 0, read)
                        val now = System.currentTimeMillis()
                        if (now - lastUiUpdate >= 300L) {
                            lastUiUpdate = now
                            val current = downloadedBytes
                            mainHandler.post {
                                if (destroyed) return@post
                                progressBar.progress = (current * 100 / MODEL_SIZE).toInt().coerceIn(0, 100)
                                modelStatus.text =
                                    "Baixando ${formatBytes(current)} de 2,59 GB · " +
                                        "${(current * 100 / MODEL_SIZE).toInt()}%."
                            }
                        }
                    }
                }
            }
            if (downloadedBytes != MODEL_SIZE) {
                throw IOException(
                    "Download incompleto: chegaram $downloadedBytes de $MODEL_SIZE bytes. " +
                        "O progresso parcial foi mantido para retomada."
                )
            }
            val actualHash = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
            if (!actualHash.equals(MODEL_SHA256, ignoreCase = true)) {
                partialFile.delete()
                throw IOException("Checksum SHA-256 não confere; o arquivo inválido foi descartado.")
            }
            if (modelFile.exists() && !modelFile.delete()) {
                throw IOException("Não foi possível substituir o arquivo de modelo anterior.")
            }
            if (!partialFile.renameTo(modelFile)) {
                throw IOException("Não foi possível finalizar o arquivo validado no armazenamento do app.")
            }
        } finally {
            activeConnection = null
            connection.disconnect()
        }
    }

    private fun confirmModelLoad() {
        if (Build.SUPPORTED_64_BIT_ABIS.isEmpty()) {
            showError("A inferência local exige um dispositivo Android 64-bit. O modo Servidor continua disponível.")
            return
        }
        val activityManager = getSystemService(ACTIVITY_SERVICE) as ActivityManager
        val memoryInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memoryInfo)
        val recommendedRam = 6L * 1024 * 1024 * 1024
        if (memoryInfo.totalMem < recommendedRam) {
            AlertDialog.Builder(this)
                .setTitle("Memória limitada")
                .setMessage(
                    "Este modelo usa cerca de 1,7 GB de RAM no benchmark publicado para um aparelho topo de linha. " +
                        "Seu celular tem ${formatBytes(memoryInfo.totalMem)} de RAM total; o desempenho e a estabilidade " +
                        "não são garantidos. Deseja tentar mesmo assim?"
                )
                .setPositiveButton("Tentar") { _, _ -> initializeModel() }
                .setNegativeButton("Cancelar", null)
                .show()
        } else {
            initializeModel()
        }
    }

    private fun initializeModel() {
        if (engine != null || !modelFile.isFile || modelFile.length() != MODEL_SIZE) {
            if (!modelFile.isFile || modelFile.length() != MODEL_SIZE) {
                showError("O arquivo local não está completo. Baixe e valide o modelo antes de iniciar.")
            }
            return
        }
        val initialHistory = history.takeLast(MAX_HISTORY_MESSAGES).toList()
        modelButton.isEnabled = false
        modelStatus.text = "Carregando o modelo no celular; isso pode levar alguns segundos..."
        ioExecutor.execute {
            var candidateEngine: Engine? = null
            try {
                candidateEngine = Engine(
                    EngineConfig(
                        modelPath = modelFile.absolutePath,
                        backend = Backend.CPU(),
                        cacheDir = cacheDir.absolutePath
                    )
                )
                candidateEngine.initialize()
                val initialMessages = initialHistory.map { saved ->
                    if (saved.role == "user") Message.user(saved.content) else Message.model(saved.content)
                }
                val candidateConversation = candidateEngine.createConversation(
                    ConversationConfig(
                        systemInstruction = Contents.of(
                            "Você é o JARVES AI, um assistente local. Responda em português por padrão. " +
                                "Não invente fatos, ferramentas executadas ou acesso à internet. " +
                                "Quando faltar informação, diga claramente."
                        ),
                        initialMessages = initialMessages,
                        maxOutputToken = 512
                    )
                )
                val readyEngine = candidateEngine
                mainHandler.post {
                    if (destroyed) {
                        closeResources(candidateConversation, readyEngine)
                        return@post
                    }
                    engine = readyEngine
                    conversation = candidateConversation
                    refreshModelPanel()
                    setStatus("Modelo local pronto. Nenhuma conversa é enviada à internet.")
                }
            } catch (error: Exception) {
                candidateEngine?.let { safelyCloseEngine(it) }
                Log.e(TAG, "Não foi possível inicializar o modelo local.", error)
                mainHandler.post {
                    if (destroyed) return@post
                    refreshModelPanel()
                    showError("Falha ao iniciar o modelo local: ${error.message ?: error.javaClass.simpleName}.")
                }
            } catch (error: LinkageError) {
                candidateEngine?.let { safelyCloseEngine(it) }
                Log.e(TAG, "Biblioteca nativa LiteRT-LM incompatível com este aparelho.", error)
                mainHandler.post {
                    if (destroyed) return@post
                    refreshModelPanel()
                    showError(
                        "A biblioteca local não é compatível com este aparelho ou Android. " +
                            "Detalhe: ${error.message ?: error.javaClass.simpleName}."
                    )
                }
            }
        }
    }

    private fun sendMessage() {
        val promptText = input.text.toString().trim()
        val activeConversation = conversation
        if (promptText.isEmpty() || isGenerating) return
        if (activeConversation == null) {
            showError("Baixe e inicie o modelo local antes de enviar uma mensagem.")
            return
        }

        input.text.clear()
        isGenerating = true
        sendButton.isEnabled = false
        appendMessage(promptText, user = true)
        val instruction = modes[activeMode].instruction
        val modelPrompt = "$instruction\n\nPedido da pessoa:\n$promptText"
        history.add(SavedMessage("user", modelPrompt, promptText))
        trimHistory()
        persistHistory()
        val answerBubble = appendMessage("", user = false)

        ioExecutor.execute {
            val answer = StringBuilder()
            try {
                runBlocking {
                    activeConversation.sendMessageAsync(modelPrompt).collect { chunk ->
                        val piece = chunk.toString()
                        answer.append(piece)
                        mainHandler.post {
                            if (destroyed) return@post
                            answerBubble.append(piece)
                            scrollToBottom()
                        }
                    }
                }
                val completeAnswer = answer.toString().trim()
                mainHandler.post {
                    if (destroyed) return@post
                    history.add(SavedMessage("model", completeAnswer, completeAnswer))
                    trimHistory()
                    persistHistory()
                    finishGeneration()
                    if (completeAnswer.isEmpty()) {
                        answerBubble.text = "O modelo concluiu sem retornar texto."
                    }
                }
            } catch (error: CancellationException) {
                Log.i(TAG, "Geração local cancelada.", error)
                mainHandler.post {
                    if (!destroyed) {
                        finishGeneration()
                        setStatus("Geração interrompida.")
                    }
                }
            } catch (error: Exception) {
                Log.e(TAG, "Falha durante a inferência local.", error)
                mainHandler.post {
                    if (destroyed) return@post
                    if (answer.isEmpty()) {
                        answerBubble.text =
                            "Falha no modelo local: ${error.message ?: error.javaClass.simpleName}."
                    } else {
                        answerBubble.append("\n\n[Erro durante a geração: ${error.message ?: error.javaClass.simpleName}]")
                    }
                    finishGeneration()
                    setStatus("A inferência falhou; nenhum serviço remoto foi usado como fallback.")
                }
            } catch (error: LinkageError) {
                Log.e(TAG, "Erro nativo durante a inferência local.", error)
                mainHandler.post {
                    if (destroyed) return@post
                    answerBubble.text = "O runtime local falhou neste aparelho: ${error.message ?: error.javaClass.simpleName}."
                    finishGeneration()
                    setStatus("A inferência falhou; veja o detalhe na conversa.")
                }
            }
        }
    }

    private fun selectMode(index: Int) {
        activeMode = index.coerceIn(modes.indices)
        for (i in 0 until modesContainer.childCount) {
            val button = modesContainer.getChildAt(i) as? Button ?: continue
            button.alpha = if (i == activeMode) 1f else 0.65f
        }
        if (::input.isInitialized) input.hint = when (modes[activeMode].label) {
            "Código" -> "Descreva o código ou o erro..."
            "Resumo" -> "Cole o texto que deseja resumir..."
            "Traduzir" -> "Digite o texto e o idioma desejado..."
            "Plano" -> "Descreva o objetivo que deseja planejar..."
            else -> "Pergunte ao modelo que está no celular..."
        }
    }

    private fun confirmNewChat() {
        if (isGenerating) {
            setStatus("Aguarde a resposta atual terminar antes de iniciar uma nova conversa.")
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Nova conversa local")
            .setMessage("Isso apaga o histórico de chat salvo neste celular. O arquivo do modelo será mantido.")
            .setPositiveButton("Apagar histórico") { _, _ -> clearLocalHistory() }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun clearLocalHistory() {
        history.clear()
        historyCorrupt = false
        getPreferences(MODE_PRIVATE).edit().remove(HISTORY_KEY).apply()
        chatMessages.removeAllViews()
        if (engine == null) {
            addWelcomeMessage()
            setStatus("Histórico local apagado; o modelo continua no aparelho.")
            return
        }
        val oldConversation = conversation
        conversation = null
        ioExecutor.execute {
            try {
                oldConversation?.close()
                val fresh = engine?.createConversation(
                    ConversationConfig(
                        systemInstruction = Contents.of(
                            "Você é o JARVES AI, um assistente local. Responda em português por padrão. " +
                                "Não invente fatos, ferramentas executadas ou acesso à internet. " +
                                "Quando faltar informação, diga claramente."
                        ),
                        maxOutputToken = 512
                    )
                )
                mainHandler.post {
                    if (destroyed) {
                        fresh?.close()
                        return@post
                    }
                    conversation = fresh
                    addWelcomeMessage()
                    setStatus("Nova conversa local pronta.")
                }
            } catch (error: Exception) {
                Log.e(TAG, "Não foi possível iniciar uma conversa limpa.", error)
                mainHandler.post {
                    if (!destroyed) showError("Falha ao iniciar uma nova conversa: ${error.message ?: "erro interno"}.")
                }
            }
        }
    }

    private fun confirmRemoveModel() {
        val title = if (engine == null) "Remover modelo local" else "Liberar espaço e memória"
        AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage("O arquivo do modelo e qualquer download parcial serão apagados deste celular.")
            .setPositiveButton("Remover modelo") { _, _ -> removeModelFiles() }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun removeModelFiles() {
        if (downloading) {
            cancelDownload.set(true)
            activeConnection?.disconnect()
        }
        val currentConversation = conversation
        val currentEngine = engine
        conversation = null
        engine = null
        modelButton.isEnabled = false
        ioExecutor.execute {
            try {
                currentConversation?.close()
                currentEngine?.close()
                if (modelFile.exists() && !modelFile.delete()) {
                    throw IOException("Não foi possível apagar o arquivo do modelo.")
                }
                if (partialFile.exists() && !partialFile.delete()) {
                    throw IOException("Não foi possível apagar o download parcial.")
                }
                mainHandler.post {
                    if (destroyed) return@post
                    downloading = false
                    progressBar.visibility = View.GONE
                    refreshModelPanel()
                    setStatus("Modelo removido. O histórico local foi preservado.")
                }
            } catch (error: Exception) {
                Log.e(TAG, "Falha ao remover os arquivos do modelo local.", error)
                mainHandler.post {
                    if (destroyed) return@post
                    refreshModelPanel()
                    showError("Não consegui remover o modelo: ${error.message ?: "erro de armazenamento"}.")
                }
            }
        }
    }

    private fun releaseEngineInBackground() {
        val currentConversation = conversation
        val currentEngine = engine
        conversation = null
        engine = null
        if (currentConversation == null && currentEngine == null) return
        Thread({
            try {
                ioExecutor.awaitTermination(1, java.util.concurrent.TimeUnit.DAYS)
                closeResources(currentConversation, currentEngine)
            } catch (error: InterruptedException) {
                Thread.currentThread().interrupt()
                Log.w(TAG, "Aguarde para liberar o modelo local foi interrompido.", error)
            }
        }, "jarves-local-model-release").start()
    }

    private fun closeResources(currentConversation: Conversation?, currentEngine: Engine?) {
        try {
            currentConversation?.close()
        } catch (error: Exception) {
            Log.w(TAG, "Falha ao liberar a conversa local.", error)
        }
        currentEngine?.let { safelyCloseEngine(it) }
    }

    private fun safelyCloseEngine(value: Engine) {
        try {
            value.close()
        } catch (error: Exception) {
            Log.w(TAG, "Falha ao liberar o motor local.", error)
        }
    }

    private fun readHistory(): List<SavedMessage> {
        val raw = getPreferences(MODE_PRIVATE).getString(HISTORY_KEY, null) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            val result = ArrayList<SavedMessage>()
            val first = (array.length() - MAX_HISTORY_MESSAGES).coerceAtLeast(0)
            for (index in first until array.length()) {
                val item = array.getJSONObject(index)
                val role = item.getString("role")
                if (role != "user" && role != "model") continue
                result.add(
                    SavedMessage(
                        role = role,
                        content = item.getString("content"),
                        display = item.getString("display")
                    )
                )
            }
            result
        } catch (error: JSONException) {
            historyCorrupt = true
            Log.e(TAG, "O histórico local não pôde ser lido e foi preservado sem sobrescrita.", error)
            emptyList()
        }
    }

    private fun persistHistory() {
        if (historyCorrupt) {
            setStatus("O histórico salvo está inválido; ele foi preservado. Use Nova conversa para substituí-lo.")
            return
        }
        val array = JSONArray()
        history.takeLast(MAX_HISTORY_MESSAGES).forEach { message ->
            array.put(
                JSONObject()
                    .put("role", message.role)
                    .put("content", message.content)
                    .put("display", message.display)
            )
        }
        getPreferences(MODE_PRIVATE).edit().putString(HISTORY_KEY, array.toString()).apply()
    }

    private fun trimHistory() {
        while (history.size > MAX_HISTORY_MESSAGES) history.removeAt(0)
    }

    private fun renderHistory() {
        if (history.isEmpty()) {
            addWelcomeMessage()
            if (historyCorrupt) {
                setStatus("O histórico salvo não pôde ser lido e foi preservado. Use Nova conversa para substituí-lo.")
            }
            return
        }
        history.forEach { saved ->
            appendMessage(saved.display, user = saved.role == "user")
        }
    }

    private fun addWelcomeMessage() {
        appendMessage(
            "A IA agora roda no próprio celular. Baixe o modelo de 2,59 GB para começar; depois, o chat funciona offline.",
            user = false
        )
    }

    private fun appendMessage(text: String, user: Boolean): TextView {
        val bubble = TextView(this).apply {
            this.text = text
            setTextColor(Color.WHITE)
            textSize = 15f
            setPadding(dp(13), dp(10), dp(13), dp(10))
            background = rounded(
                if (user) 0xFF293C69.toInt() else 0xFF151F34.toInt(),
                14
            )
            setTextIsSelectable(true)
        }
        val params = LinearLayout.LayoutParams(
            if (user) ViewGroup.LayoutParams.WRAP_CONTENT else ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply {
            topMargin = dp(5)
            bottomMargin = dp(5)
            if (user) {
                gravity = Gravity.END
                marginStart = dp(38)
            } else {
                marginEnd = dp(20)
            }
        }
        chatMessages.addView(bubble, params)
        scrollToBottom()
        return bubble
    }

    private fun scrollToBottom() {
        chatScroll.post { chatScroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun finishGeneration() {
        isGenerating = false
        sendButton.isEnabled = true
    }

    private fun setStatus(message: String) {
        if (::modelStatus.isInitialized && !downloading && engine == null) {
            modelStatus.text = message
        } else if (::modelStatus.isInitialized && engine != null) {
            modelStatus.text = message
        }
    }

    private fun showError(message: String) {
        if (destroyed) return
        setStatus(message)
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun makeButton(label: String, action: () -> Unit): Button {
        return Button(this).apply {
            text = label
            isAllCaps = false
            textSize = 13f
            setTextColor(Color.WHITE)
            setPadding(dp(8), 0, dp(8), 0)
            background = rounded(0xFF273454.toInt(), 11)
            setOnClickListener { action() }
        }
    }

    private fun rounded(color: Int, radiusDp: Int): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radiusDp).toFloat()
        }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density + 0.5f).toInt()

    private fun formatBytes(bytes: Long): String =
        String.format(Locale.getDefault(), "%.2f GB", bytes / 1_000_000_000.0)
}
